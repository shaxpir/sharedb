var emitter = require('../emitter');
var logger = require('../logger');

var SCHEMA_VERSION = 1;
var DEFAULT_MAX_BATCH_SIZE = 10;

// TODO: We should plan for an eventual design where multiple different browser tabs can uses
// the durable store as a mechanism for synchronizing state, even when offline. With change
// events on the durable store, each tab could have its own separate in-memory ShareDb instance.
// They would act as collaborators, mediated by the server (when connected) or by the durable
// store (when not connected). Some ideas for communication between tabs can be found here:
// https://stackoverflow.com/questions/28230845/communication-between-tabs-or-windows

/**
 * Sets up a durable store, so that ShareDB state can be persisted offline across
 * multible browser sessions.
 *
 * Rather than trying to persist offline state only when the browser shuts down,
 * or when the page unloads, we persist offline state continuously to the DurableStore.
 *
 * This is an 'offline-first' approach, which assumes that going offline is a normal
 * part of the application lifecycle, so we always write operations to the durable
 * store before sending them to the server.
 *
 * @param options A map of options that can be used to configure the durable store
 *
 * options.namespace (string, optional): Providing a namespace argument creates a separate
 * offline database, which can be useful for discriminating offline storage for different
 * users, or other similar cases where we don't want to mix offline data.
 *
 * options.maxBatchSize (integer, optional): Sets the maximum number of items written
 * during each IndexedDB insertion batch.
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
 * options.useEncryption (boolean, optional): If true, the records in the durable store will
 * have their contents encrypted (though their collection/id keys will be stored in cleartext).
 *
 * options.encryptionCallback (function returning string, optional): If the 'useEncryption'
 * flag is set to true, then this callback is used to encrypt the records in the durable store.
 * Each record is serialized as a JSON string, and then that JSON string is passed into the
 * encryptionCallback, whose return value is stored as the encrypted payload of the durable
 * record.
 *
 * options.decryptionCallback (function returning string, optional): If the 'useEncryption'
 * flag is set to true, then this callback is used to decrypt the records in the durable store.
 * The encrypted payload of each durable record is passed into this function, whose return value
 * is parsed as JSON and used to populate the 'data' field of any ShareDB doc deserialized from
 * the DurableStore.
 *
 * options.debug (boolean, optional): Determines whether logging messages should be emitted.
 *
 */
module.exports = DurableStore;
function DurableStore(options) {
  if (!window || !window.indexedDB) {
    throw new Error('can\'t create a DurableStore without the IndexedDB APIs');
  }
  emitter.EventEmitter.call(this);
  this.namespace = options.namespace || '_DEFAULT';
  this.dbName = 'sharedb_' + this.namespace;
  this.maxBatchSize = options.maxBatchSize || DEFAULT_MAX_BATCH_SIZE;
  this.docQueueItems = [];
  this.extVersionDecoder = options.extVersionDecoder || null;
  this.opErrorCallback = options.opErrorCallback || function(err) {};
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  this.debug = options.debug || false;
  this.busy = false;
  this.ready = false;
}
emitter.mixin(DurableStore);

/**
 * Initializes the DurableStore, creating the IndexedDB storage for the docs and their metadata.
 */
DurableStore.prototype.initialize = function() {
  var durableStore = this;
  var start = window.performance.now();
  var request = indexedDB.open(this.dbName, SCHEMA_VERSION);
  request.onsuccess = function(event) {
    durableStore.db = event.target.result;

    var duration = window.performance.now() - start;
    durableStore.debug && logger.info('Initialized IndexDB for DurableStore in ' + duration + ' millis');

    // Create an empty inventory object
    var newInventory = {
      id: 'inventory',
      payload: {
        collections: {}
      }
    };

    if (durableStore.isBrandNew) {
      durableStore.inventory = newInventory;

      // Store the inventory, and pass the onReady function as a callback
      durableStore._writeRecords(
        {meta: durableStore.inventory},
        function() {
          durableStore._onReady();
        }
      );
    } else {
      durableStore.ready = true;
      durableStore.getInventoryMeta(function(inventory) {
        if (inventory) {
          newInventory.payload = inventory;
        }
        durableStore.inventory = newInventory;
        durableStore._onReady();
      });
    }
  };
  request.onerror = function(event) {
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    durableStore.debug && logger.error('Error opening IndexDB (' + durableStore.dbName + '): ' + err);
  };
  request.onupgradeneeded = function(event) {
    var db = event.target.result;

    // Create an object store for metadata.
    var metaStore = db.createObjectStore('meta', {keyPath: 'id'});
    metaStore.createIndex('id', 'id', {unique: false});

    // Create an object store for docs.
    var docStore = db.createObjectStore('docs', {keyPath: 'id'});
    docStore.createIndex('id', 'id', {unique: false});

    durableStore.isBrandNew = true;
  };
};

DurableStore.prototype._onReady = function() {
  this.ready = true;
  this.emit('ready');
};

/**
 * Puts a doc into the DurableStore
 */
DurableStore.prototype.putDoc = function(doc, callback) {
  this._ensureDatabaseReady();

  var docRecord = this.makeDocRecord(doc);

  this.docQueueItems.push({
    record: docRecord,
    queue_time: window.performance.now(),
    callback: callback
  });

  if (!this.busy) {
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
  durableStore._writeRecords(
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
  this._readRecord('docs', compoundKey, callback);
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
  this._readRecord('meta', 'inventory', callback);
};

/**
 * A convenience function that returns true if there are any queued writes to IndexedDb waiting to be executed.
 */
DurableStore.prototype.hasDocsInWriteQueue = function() {
  return this.docQueueItems.length > 0;
};

/**
 * A convenience function that returns true if the offline inventory contains any docs with pending ops.
 */
DurableStore.prototype.hasPendingDocs = function() {
  this._ensureDatabaseReady();
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
  this._ensureDatabaseReady();
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
  this._ensureDatabaseReady();
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

/**
 * Writes a collection of records to the appropriate object stores,
 * all within a single transaction.
 */
DurableStore.prototype._writeRecords = function(recordsByStoreName, callback) {
  var start = window.performance.now();
  var durableStore = this;
  var itemCount = 0;
  var storeNames = Object.keys(recordsByStoreName);
  var transaction = durableStore.db.transaction(storeNames, 'readwrite');
  for (var i = 0; i < storeNames.length; i++) {
    var storeName = storeNames[i];
    var recordsForStoreName = recordsByStoreName[storeName];
    if (Array.isArray(recordsForStoreName)) {
      for (var j = 0; j < recordsForStoreName.length; j++) {
        var record = recordsForStoreName[j];
        record = this._maybeEncryptRecord(record);
        transaction.objectStore(storeName).put(record);
        itemCount++;
      }
    } else {
      var record = recordsForStoreName;
      record = this._maybeEncryptRecord(record);
      transaction.objectStore(storeName).put(record);
      itemCount++;
    }
  }
  transaction.oncomplete = function() {
    var duration = window.performance.now() - start;
    durableStore.log('Transaction (' + itemCount + ' items) complete in ' + duration + ' millis');
    callback && callback();
  };
  transaction.onerror = function(event) {
    var duration = window.performance.now() - start;
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    durableStore.logError('Transaction error (' + itemCount + ' items) in ' + duration + ' millis: ' + err);
  };
};

DurableStore.prototype._maybeEncryptRecord = function(record) {
  // Encrypt the record payload, if this durable-store is configured for encryption.
  if (this.useEncryption) {
    var recordId = record.id;
    var payloadJson = JSON.stringify(record.payload);
    var encryptedPayloadJson = this.encryptionCallback(payloadJson);
    // Clone the record so that we don't modify the original. This is important
    // when writing the inventory object, which is being read and modified
    // throughout this module, so we don't want to delete its payload.
    record = {
       id : recordId,
       encrypted_payload : encryptedPayloadJson
    };
  }
  return record;
}

/**
 * Reads a record from the IndexedDb
 */
DurableStore.prototype._readRecord = function(storeName, recordId, callback) {
  var durableStore = this;
  var start = window.performance.now();
  this._ensureDatabaseReady();
  var transaction = this.db.transaction(storeName, 'readonly');
  var store = transaction.objectStore(storeName);
  var request = store.get(recordId);
  request.onsuccess = function(event) {
    var duration = window.performance.now() - start;
    var record = event.target.result;
    if (record && (record.payload || record.encrypted_payload)) {
      durableStore.log(
        'Read record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis'
      );
      // Decrypt the record payload, if this durable-store is configured for encryption.
      if (durableStore.useEncryption && record.encrypted_payload) {
        var payloadJsonText = durableStore.decryptionCallback(record.encrypted_payload);
        record = {
          id : recordId,
          payload : JSON.parse(payloadJsonText)
        };
      }
      callback(record.payload);
    } else {
      durableStore.log(
        'Read empty record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis'
      );
      callback(null);
    }
  };
  request.onerror = function(event) {
    var err = JSON.stringify(event);
    durableStore.logError(
      'Error reading record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
    );
  };
};

/**
 * Deletes a record from the DurableStore
 */
DurableStore.prototype._deleteRecord = function(storeName, recordId, callback) {
  var durableStore = this;
  var start = window.performance.now();
  this._ensureDatabaseReady();
  var transaction = this.db.transaction(storeName, 'readwrite');
  var store = transaction.objectStore(storeName);
  var request = store.delete(recordId);
  request.onsuccess = function() {
    var duration = window.performance.now() - start;
    durableStore.log('Deleted record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis');
    if (callback) {
      callback();
    }
  };
  request.onerror = function(event) {
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    durableStore.logError(
      'Error deleting record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
    );
  };
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

DurableStore.prototype.logError = function(message) {
  logger.error('DurableStore: ' + message);
};

DurableStore.prototype.deleteDatabase = function() {
  this._ensureDatabaseReady();
  indexedDB.deleteDatabase(this.dbName);
};

DurableStore.prototype._ensureDatabaseReady = function() {
  if (!this.ready) {
    // TODO: throw a ShareDBError?
    var message = 'Not Ready';
    this.logError(message);
    throw new Error(message);
  }
};
