var logger = require('../../logger');

/**
 * In-memory storage implementation for testing purposes.
 * This storage engine keeps all data in memory and is suitable for unit tests.
 * Data is not persisted across sessions.
 *
 * @param options A map of options that can be used to configure the InMemoryStorage
 *
 * options.debug (boolean, optional): Determines whether logging messages should be emitted.
 */
module.exports = InMemoryStorage;
function InMemoryStorage(options) {
  options = options || {};
  this.debug = options.debug || false;
  this.ready = false;
  this.stores = {
    docs: {},
    meta: {}
  };
}

/**
 * Initializes the InMemoryStorage. Since this is all in-memory, initialization is synchronous
 * but we use a callback to maintain the same interface as other storage implementations.
 */
InMemoryStorage.prototype.initialize = function(onReadyCallback) {
  var storage = this;
  var start = Date.now();
  
  // Create an empty inventory object
  var inventory = {
    id: 'inventory',
    payload: {
      collections: {}
    }
  };
  
  // Store the inventory in meta
  this.stores.meta.inventory = inventory.payload;
  this.ready = true;
  
  var duration = Date.now() - start;
  this.debug && logger.info('Initialized InMemoryStorage in ' + duration + ' millis');
  
  // Call the callback asynchronously to maintain consistency with other storage implementations
  setTimeout(function() {
    onReadyCallback && onReadyCallback(inventory);
  }, 0);
};

/**
 * Ensures the storage is ready before performing operations.
 */
InMemoryStorage.prototype.ensureReady = function() {
  if (!this.ready) {
    throw new Error('InMemoryStorage has not been initialized');
  }
};

/**
 * Reads a single record from the specified store.
 */
InMemoryStorage.prototype.readRecord = function(storeName, id, callback) {
  this.ensureReady();
  
  var store = this.stores[storeName];
  if (!store) {
    callback(null);
    return;
  }
  
  var record = store[id];
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback(record || null);
  }, 0);
};

/**
 * Reads all records from the specified store.
 */
InMemoryStorage.prototype.readAllRecords = function(storeName, callback) {
  this.ensureReady();
  
  var store = this.stores[storeName];
  if (!store) {
    callback([]);
    return;
  }
  
  var records = [];
  for (var id in store) {
    if (store.hasOwnProperty(id)) {
      records.push({
        id: id,
        payload: store[id]
      });
    }
  }
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback(records);
  }, 0);
};

/**
 * Writes records to the storage. Records object can contain 'docs' and/or 'meta' arrays.
 */
InMemoryStorage.prototype.writeRecords = function(records, callback) {
  this.ensureReady();
  
  var storage = this;
  var docsWritten = 0;
  var metaWritten = 0;
  
  // Process docs if present
  if (records.docs) {
    var docsRecords = Array.isArray(records.docs) ? records.docs : [records.docs];
    for (var i = 0; i < docsRecords.length; i++) {
      var doc = docsRecords[i];
      storage.stores.docs[doc.id] = doc.payload;
      docsWritten++;
    }
  }
  
  // Process meta if present (can be a single object or an array)
  if (records.meta) {
    var metaRecords = Array.isArray(records.meta) ? records.meta : [records.meta];
    for (var j = 0; j < metaRecords.length; j++) {
      var meta = metaRecords[j];
      storage.stores.meta[meta.id] = meta.payload;
      metaWritten++;
    }
  }
  
  this.debug && logger.info('InMemoryStorage wrote ' + docsWritten + ' docs and ' + metaWritten + ' meta records');
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback && callback();
  }, 0);
};

/**
 * Deletes a record from the specified store.
 */
InMemoryStorage.prototype.deleteRecord = function(storeName, id, callback) {
  this.ensureReady();
  
  var store = this.stores[storeName];
  if (store && store[id]) {
    delete store[id];
    this.debug && logger.info('InMemoryStorage deleted record ' + id + ' from ' + storeName);
  }
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback && callback();
  }, 0);
};

/**
 * Clears all records from the specified store.
 */
InMemoryStorage.prototype.clearStore = function(storeName, callback) {
  this.ensureReady();
  
  if (this.stores[storeName]) {
    var count = Object.keys(this.stores[storeName]).length;
    this.stores[storeName] = {};
    this.debug && logger.info('InMemoryStorage cleared ' + count + ' records from ' + storeName);
  }
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback && callback();
  }, 0);
};

/**
 * Clears all data from all stores (useful for testing).
 */
InMemoryStorage.prototype.clearAll = function(callback) {
  this.ensureReady();
  
  this.stores.docs = {};
  this.stores.meta = {};
  
  // Restore the inventory
  this.stores.meta.inventory = {
    collections: {}
  };
  
  this.debug && logger.info('InMemoryStorage cleared all data');
  
  // Call the callback asynchronously to maintain consistency
  setTimeout(function() {
    callback && callback();
  }, 0);
};