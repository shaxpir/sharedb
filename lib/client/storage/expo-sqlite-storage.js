var logger = require('../../logger');
var SQLite = require('expo-sqlite');
var DefaultSchemaStrategy = require('./schema/default-schema-strategy');

/**
 * @param options A map of options that can be used to configure the ExpoSqliteStorage
 *
 * options.namespace (string, optional): Providing a namespace argument creates a separate
 * offline database, which can be useful for discriminating offline storage for different
 * users, or other similar cases where we don't want to mix offline data.
 *
 * options.schemaStrategy (SchemaStrategy instance, optional): A schema strategy instance that
 * defines how data is organized in the database. If not provided, uses DefaultSchemaStrategy.
 *
 * options.useEncryption (boolean, optional): If true, the records in the durable store will
 * have their contents encrypted. Only used if schemaStrategy is not provided.
 *
 * options.encryptionCallback (function returning string, optional): Callback used to encrypt
 * records. Only used if schemaStrategy is not provided.
 *
 * options.decryptionCallback (function returning string, optional): Callback used to decrypt
 * records. Only used if schemaStrategy is not provided.
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
  this.debug = options.debug || false;
  this.ready = false;
  
  // Use provided schema strategy or create default one
  if (options.schemaStrategy) {
    this.schemaStrategy = options.schemaStrategy;
  } else {
    // Create DefaultSchemaStrategy with backward-compatible options
    this.schemaStrategy = new DefaultSchemaStrategy({
      useEncryption: options.useEncryption || false,
      encryptionCallback: options.encryptionCallback,
      decryptionCallback: options.decryptionCallback,
      debug: this.debug
    });
  }
}

/**
 * Initializes the ExpoSqliteStorage and its schema strategy.
 */
ExpoSqliteStorage.prototype.initialize = function(onReadyCallback) {
  var storage = this;
  var start = Date.now();

  try {
    var dbOptions = { useNewConnection: true };
    var db = SQLite.openDatabaseSync(storage.dbFileName, dbOptions, storage.dbFileDir);
    storage.db = db;

    // Initialize schema using the strategy
    storage.schemaStrategy.initializeSchema(db, function(error) {
      if (error) {
        console.error('Error initializing schema:', error);
        throw error;
      }

      var duration = Date.now() - start;
      storage.debug && logger.info('Initialized db for ExpoSqliteStorage in ' + duration + ' millis');

      // Initialize inventory using the strategy
      storage.schemaStrategy.initializeInventory(db, function(err, inventory) {
        if (err) {
          console.error('Error initializing inventory:', err);
          throw err;
        }
        
        storage.ready = true;
        onReadyCallback(inventory);
      });
    });
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

ExpoSqliteStorage.prototype.isReady = function() {
  return this.ready;
}

/**
 * Writes a collection of records using the schema strategy.
 */
ExpoSqliteStorage.prototype.writeRecords = function(recordsByType, callback) {
  this.ensureReady();
  this.schemaStrategy.writeRecords(this.db, recordsByType, callback);
}

/**
 * Reads a record using the schema strategy.
 */
ExpoSqliteStorage.prototype.readRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  
  // Determine type and collection from storeName
  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;
  
  this.schemaStrategy.readRecord(this.db, type, collection, recordId, function(error, record) {
    if (error) {
      console.error('Error reading record:', error);
      callback(null);
      return;
    }
    
    // Return just the payload for backward compatibility
    callback(record ? record.payload : null);
  });
};

/**
 * Deletes a record using the schema strategy.
 */
ExpoSqliteStorage.prototype.deleteRecord = function(storeName, recordId, callback) {
  this.ensureReady();
  
  // Determine type and collection from storeName
  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;
  
  this.schemaStrategy.deleteRecord(this.db, type, collection, recordId, callback);
};

/**
 * Reads all records from a store using the schema strategy.
 */
ExpoSqliteStorage.prototype.readAllRecords = function(storeName, callback) {
  this.ensureReady();
  
  // Determine type and collection from storeName
  var type = storeName === 'meta' ? 'meta' : 'docs';
  var collection = storeName === 'meta' ? null : storeName;
  
  this.schemaStrategy.readAllRecords(this.db, type, collection, callback);
};

/**
 * Updates inventory using the schema strategy.
 */
ExpoSqliteStorage.prototype.updateInventory = function(collection, docId, version, operation, callback) {
  this.ensureReady();
  this.schemaStrategy.updateInventoryItem(this.db, collection, docId, version, operation, callback);
};

/**
 * Reads inventory using the schema strategy.
 */
ExpoSqliteStorage.prototype.readInventory = function(callback) {
  this.ensureReady();
  this.schemaStrategy.readInventory(this.db, callback);
};

ExpoSqliteStorage.prototype.log = function(message) {
  this.debug && logger.info('ExpoSqliteStorage: ' + message);
};

ExpoSqliteStorage.prototype.logError = function(message) {
  logger.error('ExpoSqliteStorage: ' + message);
};

/**
 * Deletes the database tables.
 * Note: This is a simplified version. A more complete implementation
 * would need to handle schema-specific table cleanup.
 */
ExpoSqliteStorage.prototype.deleteDatabase = function() {
  this.ensureReady();
  // This should ideally be delegated to the schema strategy
  // For now, just drop common tables
  this.db.runAsync('DROP TABLE IF EXISTS meta');
  this.db.runAsync('DROP TABLE IF EXISTS docs');
  this.db.runAsync('DROP TABLE IF EXISTS inventory');
};

ExpoSqliteStorage.prototype.ensureReady = function() {
  if (!this.ready) {
    // TODO: throw a ShareDBError?
    var message = 'Not Ready';
    this.logError(message);
    throw new Error(message);
  }
};