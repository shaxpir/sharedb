var logger = require('../../logger');
var SQLite = require('expo-sqlite');

/**
 * @param options A map of options that can be used to configure the ExpoSqliteStorage
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
module.exports = ExpoSqliteStorage;
function ExpoSqliteStorage(options) {
  if (!SQLite) {
    throw new Error('can\'t create a ExpoSqliteStorage without the expo-sqlite APIs');
  }
  options = options || {};
  this.namespace = options.namespace || '_DEFAULT';
  this.dbName = 'sharedb_' + this.namespace;
  this.dbFileName = options.dbFileName || this.dbName + '.db';
  this.dbFileDir = options.dbFileDir;
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  this.debug = options.debug || false;
  this.ready = false;
}

/**
 * Initializes the ExpoSqliteStorage, creating the IndexedDB storage for the docs and their metadata.
 */
ExpoSqliteStorage.prototype.initialize = function(onReadyCallback) {
  var storage = this;
  var start = Date.now();

  try {
    var dbOptions = { useNewConnection: true };
    var db = SQLite.openDatabaseSync(storage.dbFileName || 'sharedb.db', dbOptions, storage.dbFileDir);

    // Create the tables
    var promises = [];
    promises.push(db.runAsync(
      `CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        data JSON
      )`
    ).promise());
    promises.push(db.runAsync(
      `CREATE TABLE IF NOT EXISTS meta (
        id TEXT PRIMARY KEY,
        data JSON
      )`
    ).promise());

    // When the tables are guaranteed to exist, read or setup the inventory
    Promise.all(promises).then(function() {
      var duration = Date.now() - start;
      storage.debug && logger.info('Initialized db for ExpoSqliteStorage in ' + duration + ' millis');
      storage.db = db;

      // Create an empty inventory object
      var newInventory = {
        id: 'inventory',
        payload: {
          collections: {}
        }
      };

      // Try to read an inventory record
      storage.readRecord(
        'meta', 'inventory',
        function(inventory) {
          if (inventory) {
            storage.ready = true;
            newInventory.payload = inventory;
            onReadyCallback(newInventory);
          } else {
            // If no inventory record exists yet, then we need to store the new (empty) inventory.
            storage.writeRecords(
              {meta: newInventory},
              function() {
                storage.ready = true;
                onReadyCallback(newInventory);
              }
            );
          }
        }
      );
    }).catch(function(reason) {
      console.error('Rejected promise while initializing database:', reason);
      throw reason;
    });

    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

ExpoSqliteStorage.prototype.isReady = function() {
  return this.ready;
}

/**
 * Writes a collection of records to the appropriate object stores,
 * all within a single transaction.
 */
ExpoSqliteStorage.prototype.writeRecords = function(recordsByStoreName, callback) {
  var storage = this;
  var start = Date.now();
  var itemCount = 0;
  var storeNames = Object.keys(recordsByStoreName);
  // TODO: use a single transaction for all these updates
  for (var i = 0; i < storeNames.length; i++) {
    var storeName = storeNames[i];
    var insertions = [];
    var records = recordsByStoreName[storeName];
    if (Array.isArray(records)) {
      for (var j = 0; j < records.length; j++) {
        var record = records[j]; // An item from the array
        record = storage.maybeEncryptRecord(record);
        insertions.push([ record.id, JSON.stringify(record) ]);
        itemCount++;
      }
    } else {
      var record = records; // There is no array. The records var is the record.
      record = storage.maybeEncryptRecord(record);
      insertions.push([ record.id, JSON.stringify(record) ]);
      itemCount++;
    }
    db.runAsync(
      'INSERT OR REPLACE INTO \'' + storeName + '\' (id, data) VALUES (?, ?)',
      insertions
    ).then(
      function() {
        var duration = Date.now() - start;
        storage.log('Transaction (' + itemCount + ' items) complete in ' + duration + ' millis');
        callback && callback();
      }
    ).catch(
      function(reason) {
        var duration = Date.now() - start;
        // TODO: handle the error, or throw a ShareDBError?
        var err = JSON.stringify(reason);
        storage.logError('Transaction error (' + itemCount + ' items) in ' + duration + ' millis: ' + err);
      }
    );
  }
};

ExpoSqliteStorage.prototype.maybeEncryptRecord = function(record) {
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
ExpoSqliteStorage.prototype.readRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  var storage = this;
  var start = Date.now();
  try {
    storage.db.getFirstAsync(
      'SELECT data FROM ' + storeName + ' WHERE id = ?',
      [recordId]
    ).then(
      (record) => {
        var duration = Date.now() - start;
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
      },
      function(reason) {
        var err = JSON.stringify(reason);
        storage.logError(
          'Error reading record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
        );
      }
    );
    if (!result) return null;
    return result;
  } catch (error) {
    console.error('Error getting proficiency entry:', error);
    throw error;
  }
};

/**
 * Deletes a record from the ExpoSqliteStorage
 */
ExpoSqliteStorage.prototype.deleteRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  var storage = this;
  var start = Date.now();
  storage.db.runAsync('DELETE FROM ' + storeName + ' WHERE id = ' + recordId).then(() => {
    var duration = window.performance.now() - start;
    storage.log('Deleted record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis');
    callback && callback();
  }).catch((reason) => {
    // TODO: handle the error, or throw a ShareDBError?
    var err = JSON.stringify(reason);
    storage.logError(
      'Error deleting record (' + recordId + ') from store (' + storeName + ') in ' + duration + ' millis: ' + err
    );
  });
};

ExpoSqliteStorage.prototype.log = function(message) {
  this.debug && logger.info('ExpoSqliteStorage: ' + message);
};

ExpoSqliteStorage.prototype.logError = function(message) {
  logger.error('ExpoSqliteStorage: ' + message);
};

ExpoSqliteStorage.prototype.deleteDatabase = function() {
  this.ensureReady();
  this.db.runAsync(`DROP TABLE IF EXISTS meta`);
  this.db.runAsync(`DROP TABLE IF EXISTS docs`);
};

ExpoSqliteStorage.prototype.ensureReady = function() {
  if (!this.ready) {
    // TODO: throw a ShareDBError?
    var message = 'Not Ready';
    this.logError(message);
    throw new Error(message);
  }
};