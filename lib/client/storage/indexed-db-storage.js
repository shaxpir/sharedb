var logger = require('../../logger');

var SCHEMA_VERSION = 1;

/**
 * @param options A map of options that can be used to configure the IndexedDbStorage
 *
 * options.namespace (string, optional): Providing a namespace argument creates a separate
 * offline database, which can be useful for discriminating offline storage for different
 * users, or other similar cases where we don't want to mix offline data.
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
 */
module.exports = IndexedDbStorage;
function IndexedDbStorage(options) {
  if (!window || !window.indexedDB) {
    throw new Error('can\'t create a IndexedDbStorage without the IndexedDB APIs');
  }
  this.namespace = options.namespace || '_DEFAULT';
  this.dbName = 'sharedb_' + this.namespace;
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  this.debug = options.debug || false;
  this.maxBatchSize = options.maxBatchSize || 100; // For batched operations
  this.ready = false;
}

/**
 * Initializes the IndexedDbStorage, creating the IndexedDB storage for the docs and their metadata.
 */
IndexedDbStorage.prototype.initialize = function(onReadyCallback) {
  var storage = this;
  var start = window.performance.now();
  var request = indexedDB.open(this.dbName, SCHEMA_VERSION);
  request.onsuccess = function(event) {
    storage.db = event.target.result;

    var duration = window.performance.now() - start;
    storage.debug && logger.info('Initialized IndexDB for IndexedDbStorage in ' + duration + ' millis');

    // Create an empty inventory object
    var newInventory = {
      id: 'inventory',
      payload: {
        collections: {}
      }
    };

    if (storage.isBrandNew) {
      storage.ready = true; // Set ready before writing
      storage.writeRecords(
        {meta: newInventory},
        function() {
          storage.isBrandNew = false;
          onReadyCallback(newInventory);
        }
      );
    } else {
      storage.ready = true;
      storage.readRecord(
        'meta', 'inventory',
        function(inventory) {
          if (inventory) {
            newInventory.payload = inventory;
          }
          onReadyCallback(newInventory);
        }
      );
    }
  };
  request.onerror = function(event) {
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    storage.debug && logger.error('Error opening IndexDB (' + storage.dbName + '): ' + err);
  };
  request.onupgradeneeded = function(event) {
    var db = event.target.result;

    // Create an object store for metadata.
    var metaStore = db.createObjectStore('meta', {keyPath: 'id'});
    metaStore.createIndex('id', 'id', {unique: false});

    // Create an object store for docs.
    var docStore = db.createObjectStore('docs', {keyPath: 'id'});
    docStore.createIndex('id', 'id', {unique: false});

    storage.isBrandNew = true;
  };
};

IndexedDbStorage.prototype.isReady = function() {
  return this.ready;
};

/**
 * Writes a collection of records to the appropriate object stores,
 * all within a single transaction.
 */
IndexedDbStorage.prototype.writeRecords = function(recordsByStoreName, callback) {
  var storage = this;
  var start = window.performance.now();
  var itemCount = 0;
  var storeNames = Object.keys(recordsByStoreName);
  var transaction = storage.db.transaction(storeNames, 'readwrite');
  for (var i = 0; i < storeNames.length; i++) {
    var storeName = storeNames[i];
    var recordsForStoreName = recordsByStoreName[storeName];
    if (Array.isArray(recordsForStoreName)) {
      for (var j = 0; j < recordsForStoreName.length; j++) {
        var record = recordsForStoreName[j];
        record = this.maybeEncryptRecord(record);
        transaction.objectStore(storeName).put(record);
        itemCount++;
      }
    } else {
      var record = recordsForStoreName;
      record = this.maybeEncryptRecord(record);
      transaction.objectStore(storeName).put(record);
      itemCount++;
    }
  }
  transaction.oncomplete = function() {
    var duration = window.performance.now() - start;
    storage.log('Transaction (' + itemCount + ' items) complete in ' + duration + ' millis');
    callback && callback();
  };
  transaction.onerror = function(event) {
    var duration = window.performance.now() - start;
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    storage.logError('Transaction error (' + itemCount + ' items) in ' + duration + ' millis: ' + err);
  };
};

IndexedDbStorage.prototype.maybeEncryptRecord = function(record) {
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
IndexedDbStorage.prototype.readRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  var storage = this;
  var start = window.performance.now();
  var transaction = this.db.transaction(storeName, 'readonly');
  var store = transaction.objectStore(storeName);
  var request = store.get(recordId);
  request.onsuccess = function(event) {
    var duration = window.performance.now() - start;
    var record = event.target.result;
    if (record && (record.payload || record.encrypted_payload)) {
      storage.log(
        'Read record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis'
      );
      // Decrypt the record payload, if this durable-store is configured for encryption.
      if (storage.useEncryption && record.encrypted_payload) {
        var payloadJsonText = storage.decryptionCallback(record.encrypted_payload);
        record = {
          id : recordId,
          payload : JSON.parse(payloadJsonText)
        };
      }
      callback(record.payload);
    } else {
      storage.log(
        'Read empty record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis'
      );
      callback(null);
    }
  };
  request.onerror = function(event) {
    var err = JSON.stringify(event);
    storage.logError(
      'Error reading record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
    );
  };
};

/**
 * Deletes a record from the IndexedDbStorage
 */
IndexedDbStorage.prototype.deleteRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  var storage = this;
  var start = window.performance.now();
  var transaction = this.db.transaction(storeName, 'readwrite');
  var store = transaction.objectStore(storeName);
  var request = store.delete(recordId);
  request.onsuccess = function() {
    var duration = window.performance.now() - start;
    storage.log('Deleted record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis');
    if (callback) {
      callback();
    }
  };
  request.onerror = function(event) {
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(event);
    storage.logError(
      'Error deleting record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
    );
  };
};

IndexedDbStorage.prototype.log = function(message) {
  this.debug && logger.info('IndexedDbStorage: ' + message);
};

IndexedDbStorage.prototype.logError = function(message) {
  logger.error('IndexedDbStorage: ' + message);
};

IndexedDbStorage.prototype.deleteDatabase = function() {
  this.ensureReady();
  indexedDB.deleteDatabase(this.dbName);
};

IndexedDbStorage.prototype.ensureReady = function() {
  if (!this.ready) {
    // TODO: throw a ShareDBError?
    var message = 'IndexedDbStorage has not been initialized';
    this.logError(message);
    throw new Error(message);
  }
};

/**
 * Reads all records from the specified store
 */
IndexedDbStorage.prototype.readAllRecords = function(storeName, callback) {
  this.ensureReady();
  var storage = this;
  var start = window.performance.now();
  var transaction = this.db.transaction(storeName, 'readonly');
  var store = transaction.objectStore(storeName);
  var request = store.getAll();
  
  request.onsuccess = function(event) {
    var duration = window.performance.now() - start;
    var records = event.target.result || [];
    storage.log('Read ' + records.length + ' records from store (' + storeName + ') in ' + duration + ' millis');
    
    // Decrypt records if needed
    var decryptedRecords = [];
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (storage.useEncryption && record.encrypted_payload) {
        var payloadJsonText = storage.decryptionCallback(record.encrypted_payload);
        decryptedRecords.push({
          id: record.id,
          payload: JSON.parse(payloadJsonText)
        });
      } else if (record.payload) {
        decryptedRecords.push({
          id: record.id,
          payload: record.payload
        });
      }
    }
    
    callback(decryptedRecords);
  };
  
  request.onerror = function(event) {
    var err = JSON.stringify(event);
    storage.logError('Error reading all records from store (' + storeName + '): ' + err);
    callback([]);
  };
};

/**
 * Reads multiple records by ID from the specified store in a single transaction.
 * 
 * @param {string} storeName - Name of the store to read from
 * @param {string[]} ids - Array of record IDs to retrieve
 * @param {function} callback - Callback function (error, records)
 */
IndexedDbStorage.prototype.readRecordsBulk = function(storeName, ids, callback) {
  this.ensureReady();
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return callback(null, []);
  }
  
  var storage = this;
  var start = window.performance.now();
  var transaction = this.db.transaction(storeName, 'readonly');
  var store = transaction.objectStore(storeName);
  var records = [];
  var completed = 0;
  var hasError = false;
  
  // Function to handle individual record retrieval
  var processRecord = function(id) {
    var request = store.get(id);
    
    request.onsuccess = function(event) {
      if (hasError) return;
      
      var record = event.target.result;
      if (record && (record.payload || record.encrypted_payload)) {
        // Decrypt the record payload, if this durable-store is configured for encryption
        if (storage.useEncryption && record.encrypted_payload) {
          var payloadJsonText = storage.decryptionCallback(record.encrypted_payload);
          records.push({
            id: id,
            payload: JSON.parse(payloadJsonText)
          });
        } else if (record.payload) {
          records.push({
            id: id,
            payload: record.payload
          });
        }
      }
      
      completed++;
      if (completed === ids.length) {
        var duration = window.performance.now() - start;
        storage.log('Bulk read ' + records.length + '/' + ids.length + ' records from store (' + storeName + ') in ' + duration + ' millis');
        callback(null, records);
      }
    };
    
    request.onerror = function(event) {
      if (hasError) return;
      hasError = true;
      var err = JSON.stringify(event);
      storage.logError('Error bulk reading record (' + id + ') from store (' + storeName + '): ' + err);
      callback(new Error('IndexedDB bulk read error: ' + err), null);
    };
  };
  
  // Start all requests
  for (var i = 0; i < ids.length; i++) {
    processRecord(ids[i]);
  }
};

/**
 * Clears all records from the specified store
 */
IndexedDbStorage.prototype.clearStore = function(storeName, callback) {
  this.ensureReady();
  var storage = this;
  var start = window.performance.now();
  var transaction = this.db.transaction(storeName, 'readwrite');
  var store = transaction.objectStore(storeName);
  var request = store.clear();
  
  request.onsuccess = function() {
    var duration = window.performance.now() - start;
    storage.log('Cleared store (' + storeName + ') in ' + duration + ' millis');
    if (callback) {
      callback();
    }
  };
  
  request.onerror = function(event) {
    var err = JSON.stringify(event);
    storage.logError('Error clearing store (' + storeName + '): ' + err);
    if (callback) {
      callback();
    }
  };
};

/**
 * Clears all data from all stores and restores inventory
 */
IndexedDbStorage.prototype.clearAll = function(callback) {
  this.ensureReady();
  var storage = this;
  
  // Clear both stores
  var transaction = this.db.transaction(['docs', 'meta'], 'readwrite');
  transaction.objectStore('docs').clear();
  transaction.objectStore('meta').clear();
  
  transaction.oncomplete = function() {
    // Restore inventory
    var newInventory = {
      id: 'inventory',
      payload: {
        collections: {}
      }
    };
    
    storage.writeRecords(
      {meta: newInventory},
      function() {
        storage.log('Cleared all data and restored inventory');
        if (callback) {
          callback();
        }
      }
    );
  };
  
  transaction.onerror = function(event) {
    var err = JSON.stringify(event);
    storage.logError('Error clearing all data: ' + err);
    if (callback) {
      callback();
    }
  };
};