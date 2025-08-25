var emitter = require('../emitter');
var logger = require('../logger');

var DEFAULT_MAX_BATCH_SIZE = 10;

/**
 * Sets up a durable store, so that ShareDB state can be persisted offline across
 * multible browser sessions.
 *
 * Rather than trying to persist offline state only when the browser (or app) shuts down,
 * or when the page unloads, we persist offline state continuously to the DurableStore.
 *
 * This is an 'offline-first' approach, which assumes that going offline is a normal
 * part of the application lifecycle, so we always write operations to the durable
 * store before sending them to the server.
 *
 * @param storage A storage engine instance (e.g., IndexedDbStorage, ExpoSqliteStorage, InMemoryStorage)
 * @param options A map of options that can be used to configure the durable store
 *
 * options.maxBatchSize (integer, optional): Sets the maximum number of items written
 * during each storage insertion batch.
 *
 * options.extVersionDecoder (function returning string or number, optional): Called on each
 * doc record's 'data' object, before insertion into the durable store, to determine the
 * version that should be recorded in the inventory. By default, we use the native 'doc.version'
 * from ShareDB, but an application can supply its own "version-decoder" function to return
 * an app-specific version number or string.
 *
 * options.opErrorCallback (void function, optional): Certain OT operations emit conflicts.
 * This callback allows the application handle those conflicts (e.g., log a message, throw
 * an error, ignore it, etc). If a callback is not supplied here, the durable store will use
 * its own default (empty) callback, which will ignore all conflicts.
 *
 * options.debug (boolean, optional): Determines whether logging messages should be emitted.
 */
module.exports = DurableStore;
function DurableStore(storage, options) {
  emitter.EventEmitter.call(this);
  if (!storage) {
    throw new Error('storage engine is required for DurableStore');
  }
  this.storage = storage;
  options = options || {};
  this.maxBatchSize = options.maxBatchSize || DEFAULT_MAX_BATCH_SIZE;
  this.docQueueItems = [];
  this.extVersionDecoder = options.extVersionDecoder || null;
  this.opErrorCallback = options.opErrorCallback || function(err) {};
  this.debug = options.debug || false;
  this.busy = false;
  this._autoBatchEnabled = true;
}
emitter.mixin(DurableStore);

/**
 * Initializes the underlying storage.
 */
DurableStore.prototype.initialize = function() {
  this.storage.initialize(this._onReady);
};

DurableStore.prototype._onReady = function(inventory) {
  this.inventory = inventory;
  this.emit('ready');
};

/**
 * Puts a doc into the DurableStore
 */
DurableStore.prototype.putDoc = function(doc, callback) {
  this.storage.ensureReady();

  var docRecord = this.makeDocRecord(doc);

  this.docQueueItems.push({
    record: docRecord,
    queue_time: window.performance.now(),
    callback: callback
  });

  if (!this.busy && this._autoBatchEnabled !== false) {
    this._putNextBatchFromQueue();
  }
};

DurableStore.prototype.makeDocRecord = function(doc) {
  // Only store the "truthiness" of pendingOps' source property
  var storedPendingOps = doc.pendingOps.map(function(op) {
    return Object.assign({}, op, {source: !!op.source});
  });

  // Clone the inflightOp and also store only its "truthiness" in the source property
  var storedInflightOp = doc.inflightOp ?
    Object.assign({}, doc.inflightOp, {source: !!doc.inflightOp.source}) :
    null;

  // HACK! The persisted inflightOp should always have the src set.  The
  // inflightOp only has a null src the first time it is sent.  If a doc is
  // ever restored with an inflightOp, then the doc will definitely resubmit
  // the op with a new connection id (src), but we want to preserve the
  // original connection id that is about to be assigned to the src property of
  // the inflightOp once it is sent to the server.
  if (storedInflightOp && storedInflightOp.src == null) {
    storedInflightOp.src = doc.connection.id;
  }

  var docRecord = {
    id: doc.collection + '/' + doc.id,
    payload: {
      collection: doc.collection,
      id: doc.id,
      type_name: (doc.type && doc.type.name) ? doc.type.name : null,
      version: doc.version,
      data: doc.data,
      pendingOps: JSON.parse(JSON.stringify(storedPendingOps)),
      inflightOp: JSON.parse(JSON.stringify(storedInflightOp)),
      preventCompose: doc.preventCompose,
      submitSource: doc.submitSource
    }
  };

  return docRecord;
}

/**
 * Consumes doc records from the queue, prepares a batch for writing to IndexedDb, and
 * executes all their callbacks (in order) when the batch completes.
 */
DurableStore.prototype._putNextBatchFromQueue = function() {
  if (!this.ready || this.busy || !this.hasDocsInWriteQueue()) {
    return;
  }
  this.busy = true;

  // Accumulate records into a batch by consuming from the queue. If we already have another record
  // in the batch with the same ID, then put this record back where we found it, and close the batch.
  var keysInBatch = {};
  var docQueueItemsInBatch = [];
  var docRecordsInBatch = [];
  while (this.docQueueItems.length > 0 && docRecordsInBatch.length < this.maxBatchSize) {
    var docQueueItem = this.docQueueItems.shift();
    var docRecord = docQueueItem.record;
    if (keysInBatch[docRecord.id]) {
      this.docQueueItems.unshift(docQueueItem);
      break;
    }
    docQueueItemsInBatch.push(docQueueItem);
    docRecordsInBatch.push(docRecord);
    keysInBatch[docRecord.id] = true;
  }

  // Itereate through all the records in the batch, and update the inventory for each one.
  // First, make sure the inventory has an entry for the this collection, and then add an entry
  // for this doc. The 'v' field indicates the current version number of the doc (either from the
  // ShareDB doc.version, or the app-specific extVersionDecoder function). The 'p' field
  // indicates whether this doc has pending operations waiting to sync with the server.
  for (var i = 0; i < docRecordsInBatch.length; i++) {
    var docRecord = docRecordsInBatch[i];
    var collection = docRecord.payload.collection;
    var id = docRecord.payload.id;
    var hasInflightOp = !!docRecord.payload.inflightOp;
    var hasPendingOps = docRecord.payload.pendingOps && docRecord.payload.pendingOps.length > 0;
    if (!this.inventory.payload.collections.hasOwnProperty(collection)) {
      this.inventory.payload.collections[collection] = {};
    }
    // Generate a version identifier to store in the inventory. This could be either an app-specific
    // version retrieved from somewhere in the actual doc.data payload, or it might just be the
    // default ShareDB 'version' number.
    var docVersion = this.makeInventoryVersion(docRecord);
    this.inventory.payload.collections[collection][id] = {
      p: hasInflightOp || hasPendingOps,
      v: docVersion
    };
  }

  // Write the actual records, and upon completion, execute all their callbacks.
  var durableStore = this;
  durableStore.emit('before persist', {docs: docRecordsInBatch});
  durableStore.storage.writeRecords(
    {
      meta: durableStore.inventory,
      docs: docRecordsInBatch
    },
    function() {
      durableStore.emit('persist', {docs: docRecordsInBatch});
      var now = window.performance.now();
      for (var i = 0; i < docQueueItemsInBatch.length; i++) {
        var docQueueItem = docQueueItemsInBatch[i];
        var docCompoundKey = docQueueItem.record.id;
        var duration = now - docQueueItem.queue_time;
        durableStore.log('Wrote doc (' + docCompoundKey + ') in ' + duration + ' millis');
        docQueueItem.callback && docQueueItem.callback();
      }
      durableStore.busy = false;
      // If there are new items in the queue, process another batch.
      // Otherwise, emit a 'no persist pending' event
      if (durableStore.hasDocsInWriteQueue()) {
        durableStore._putNextBatchFromQueue();
      } else {
        durableStore.emit('no persist pending');
      }
    }
  );
};

/**
 * Retrieves a doc object from the DurableStore.
 */
DurableStore.prototype.getDoc = function(collection, id, callback) {
  var compoundKey = collection + '/' + id;
  this.storage.readRecord('docs', compoundKey, callback);
};

/**
 * Retrieves multiple doc objects from the DurableStore in a single batch operation.
 * This method leverages the storage layer's bulk capabilities for efficiency.
 * 
 * @param {string} collection - Collection name
 * @param {string[]} ids - Array of document IDs to retrieve
 * @param {function} callback - Callback function (error, docDatas)
 */
DurableStore.prototype.retrieveDocumentsBulk = function(collection, ids, callback) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return callback(null, []);
  }
  
  var storeName = 'docs';
  
  // Check if storage supports bulk operations
  if (this.storage.readRecordsBulk) {
    // Generate compound keys for all requested documents
    var compoundKeys = [];
    for (var i = 0; i < ids.length; i++) {
      compoundKeys.push(collection + '/' + ids[i]);
    }
    
    // Use storage bulk method
    this.storage.readRecordsBulk(storeName, compoundKeys, function(error, records) {
      if (error) return callback(error);
      
      // Transform storage records into doc data format
      var docDatas = [];
      if (records && records.length > 0) {
        for (var j = 0; j < records.length; j++) {
          var record = records[j];
          if (record && record.payload) {
            docDatas.push({
              id: record.payload.id,
              data: record.payload.data,
              v: record.payload.v,
              type: record.payload.type
            });
          }
        }
      }
      
      callback(null, docDatas);
    });
  } else {
    // Fallback to individual getDoc calls for storage implementations 
    // that don't support bulk operations
    var docDatas = [];
    var remaining = ids.length;
    var hasError = false;
    
    if (remaining === 0) {
      return callback(null, []);
    }
    
    for (var k = 0; k < ids.length; k++) {
      (function(id) {
        this.getDoc(collection, id, function(error, docData) {
          if (hasError) return; // Don't process if we already had an error
          
          if (error) {
            hasError = true;
            return callback(error);
          }
          
          if (docData) {
            docDatas.push(docData);
          }
          
          remaining--;
          if (remaining === 0) {
            callback(null, docDatas);
          }
        });
      }.bind(this))(ids[k]);
    }
  }
};

/**
 * Retrieves the 'inventory' object from the 'meta' object-store. This object persists
 * a map of all collections -- and all docs within those collections -- whose data is persisted
 * in the DurableStore. For each collection/id pair, there is an object with the version
 * number of the current local snapshot, and a boolean flag indicating whether any pending
 * operations are in the DurableStore, waiting to be pushed to the server when the connection
 * is reinstated.
 *
 * {
 *   'id': 'inventory',
 *   'payload' : {
 *     'collections': {
 *       'foo': {
 *         'bar': {'v': 123, 'p': true },
 *         'baz': {'v': 456, 'p': false }
 *       },
 *       'zip': {
 *         'zap': {'v': 789, 'p': false },
 *         'zop': {'v': 1011, 'p': true }
 *       }
 *     }
 *   }
 * }
 *
 * NOTE: By default, the 'v' version numbers are taken from the 'doc' objects. However, if the user
 * provided an 'extVersionDecoder' function, then we'll apply that function to each 'doc.data' and
 * use the return value as the 'v' version instead.
 *
 * The 'inventory' object is a singleton, and always has an 'id' of 'inventory '.
 */
DurableStore.prototype.getInventoryMeta = function(callback) {
  this.storage.readRecord('meta', 'inventory', callback);
};

/**
 * A convenience function that returns true if there are any queued writes to IndexedDb waiting to be executed.
 */
DurableStore.prototype.hasDocsInWriteQueue = function() {
  return this.docQueueItems.length > 0;
};

/**
 * Get the current size of the write queue
 */
DurableStore.prototype.getWriteQueueSize = function() {
  return this.docQueueItems.length;
};

/**
 * Convenience method for bulk document writes with immediate flush.
 * Temporarily disables auto-batching, adds all documents, flushes, then restores original setting.
 * 
 * @param {Doc[]} docs - Array of ShareDB documents to write
 * @param {function} callback - Callback function (error)
 */
DurableStore.prototype.putDocsBulk = function(docs, callback) {
  if (!Array.isArray(docs) || docs.length === 0) {
    callback && callback(null);
    return;
  }
  
  var durableStore = this;
  var originalAutoBatch = this._autoBatchEnabled;
  
  // Temporarily disable auto-batching
  this._autoBatchEnabled = false;
  
  var remaining = docs.length;
  var hasError = false;
  
  // Add all documents to queue
  for (var i = 0; i < docs.length; i++) {
    this.putDoc(docs[i], function(error) {
      if (hasError) return;
      
      if (error) {
        hasError = true;
        durableStore._autoBatchEnabled = originalAutoBatch;
        return callback && callback(error);
      }
      
      remaining--;
      if (remaining === 0) {
        // All documents queued, now flush
        durableStore.flush(function(flushError) {
          durableStore._autoBatchEnabled = originalAutoBatch;
          callback && callback(flushError);
        });
      }
    });
  }
};

/**
 * Force flush any pending writes immediately
 */
DurableStore.prototype.flush = function(callback) {
  if (!this.hasDocsInWriteQueue()) {
    callback && callback(null);
    return;
  }
  
  // Set up one-time listener for batch completion
  var durableStore = this;
  var onPersist = function() {
    durableStore.off('persist', onPersist);
    callback && callback(null);
  };
  
  this.on('persist', onPersist);
  this._putNextBatchFromQueue();
};

/**
 * Configure automatic batching behavior
 */
DurableStore.prototype.setAutoBatchEnabled = function(enabled) {
  this._autoBatchEnabled = !!enabled;
  
  // If we're re-enabling auto-batch and there are queued items, process them
  if (enabled && this.hasDocsInWriteQueue() && !this.busy) {
    this._putNextBatchFromQueue();
  }
};

/**
 * Get current auto-batch setting
 */
DurableStore.prototype.isAutoBatchEnabled = function() {
  return this._autoBatchEnabled;
};

/**
 * A convenience function that returns true if the offline inventory contains any docs with pending ops.
 */
DurableStore.prototype.hasPendingDocs = function() {
  this.storage.ensureReady();
  var collections = Object.keys(this.inventory.payload.collections);
  for (i = 0; i < collections.length; i++) {
    var collection = collections[i];
    var ids = Object.keys(this.inventory.payload.collections[collection]);
    for (j = 0; j < ids.length; j++) {
      var id = ids[j];
      var hasPendingOps = this.inventory.payload.collections[collection][id].p;
      if (hasPendingOps) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Retrieves all docs with pending ops from the DurableStore, and calls the designated callback on them.
 */
DurableStore.prototype.loadEachPendingDocAndThen = function(callback) {
  this.storage.ensureReady();
  var durableStore = this;
  this.forEachPendingDocCollectionId(function(collection, id) {
    durableStore.getDoc(collection, id, callback);
  });
};

/**
 * Iterates through all items in the inventory, and for any doc with pending ops,
 * calls the callback with the doc's collection and id.
 */
DurableStore.prototype.forEachPendingDocCollectionId = function(callback) {
  this.storage.ensureReady();
  var collections = Object.keys(this.inventory.payload.collections);
  for (var i = 0; i < collections.length; i++) {
    var collection = collections[i];
    var ids = Object.keys(this.inventory.payload.collections[collection]);
    for (j = 0; j < ids.length; j++) {
      var id = ids[j];
      var hasPendingOps = this.inventory.payload.collections[collection][id].p;
      if (hasPendingOps) {
        callback(collection, id);
      }
    }
  }
};

/**
 * Returns true if there is an entry in the inventory for the given collection and id, indicating that
 * the doc has been persisted in the DurableStore. Optionally, if a 'minVersion' argument is provided,
 * this function returns true if the version in the inventory is GTE the supplied 'minVersion', which
 * can be either a number or a string, depending on the 'extVersionDecoder' function provided to the
 * DurableStore constructor.
 */
DurableStore.prototype.isDocInInventory = function(collection, id, minVersion) {
  if (
    this.inventory &&
    this.inventory.payload &&
    this.inventory.payload.collections &&
    this.inventory.payload.collections.hasOwnProperty(collection) &&
    this.inventory.payload.collections[collection].hasOwnProperty(id)
  ) {
    var inventoryVersion = this.inventory.payload.collections[collection][id].v;
    return this.hasMinVersion(minVersion, inventoryVersion);
  }
  return false;
};

DurableStore.prototype.hasMinVersion = function(minVersion, testVersion) {
  // If the requested 'minVersion' is undefined, then we don't need to check the recorded 'testVersion'. Return
  // true without comparing versions, because the record is definitely in the inventory. Otherwise, if the requested
  // 'minVersion' is a string or number, use an appropriate comparison to check it against the 'testVersion'.
  if (minVersion == null || typeof(minVersion) === 'undefined') {
    return true;
  }
  // NOTE: A null 'testVersion' is only written when the 'extVersionDecoder' function observes an 'undefined'
  // value for the 'doc.data' field. This happens upon doc construction, but before the 'create' op has been applied.
  // Therefore, a null 'testVersion' is considered implicitly less than any non-null 'minVersion'.
  if (testVersion == null || typeof(testVersion) === 'undefined') {
    return false;
  }
  // Perform a string comparison of the 'minVersion' and 'testVersion'
  if (typeof(minVersion) == 'string') {
    var comparison = 0;
    if (typeof(testVersion) == 'string') {
      comparison = testVersion.localeCompare(minVersion);
    } else {
      var testVersionString = '' + testVersion;
      comparison = testVersionString.localeCompare(minVersion);
    }
    return comparison >= 0;
  }
  // Perform a numeric comparison of the 'minVersion' and 'inventoryVersion'
  if (typeof(minVersion) == 'number') {
    if (typeof(testVersion) == 'number') {
      return testVersion >= minVersion;
    } else {
      var testVersionNumber = Number.parseFloat(inventoryVersion);
      return testVersionNumber >= minVersion;
    }
  }
  return false;
};

/**
 * This function accepts a 'docRecord' before immediately writing it to the DurableStore, and returns a
 * 'version' value that can be recorded in the 'v' field of the corresponding inventory record. By default,
 * the resultant version value is taken directly from the ShareDB 'doc.version' field. But if the user
 * provided an 'extVersionDecoder' function in the constructor of this DurableStore, then we'll use the
 * value returned by that function instead.
*/
DurableStore.prototype.makeInventoryVersion = function(docRecord) {
  if (this.extVersionDecoder) {
    if (docRecord.payload.data) {
      return this.extVersionDecoder(docRecord.payload.data);
    }
    return null;
  }
  return docRecord.payload.version;
};

DurableStore.prototype.restoreDocFromDurableRecord = function(doc, callback) {
  var durableStore = this;
  this.getDoc(doc.collection, doc.id, function(durableRecord) {

    doc.collection = durableRecord.collection;
    doc.id = durableRecord.id;
    doc.version = durableRecord.version;
    doc._setData(durableRecord.data);
    doc.preventCompose = durableRecord.preventCompose;
    doc.submitSource = durableRecord.submitSource;

    // The durableRecord contains a only the type name, but we need the actual
    // type-object (with all of its member functions) in order to fully restore the doc.
    doc._setType(durableRecord.type_name);

    // We will need to set the error callback on all the ops
    var opErrorCallback = durableStore.opErrorCallback;

    // Then, we need to insert that full type object into any pendingOps contained in this doc.
    doc.pendingOps = durableRecord.pendingOps;
    for (i = 0; i < doc.pendingOps.length; i++) {
      var pendingOp = doc.pendingOps[i];
      pendingOp.type = doc.type;
      pendingOp.callbacks = [ opErrorCallback ];
    }

    // If there was an inflightOp, we need to add it back to the front of the pendingOps queue
    var inflightOp = durableRecord.inflightOp;
    if (inflightOp) {
      inflightOp.type = doc.type;
      inflightOp.callbacks = [ opErrorCallback ];
      doc.pendingOps.unshift(inflightOp);
    }

    doc.emit('restore');

    callback && callback();
  });
};

DurableStore.prototype.log = function(message) {
  this.debug && logger.info('DurableStore: ' + message);
};

DurableStore.prototype.deleteDatabase = function() {
  this.storage.deleteDatabase();
};