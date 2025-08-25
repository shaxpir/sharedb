var SqliteStorage = require('./sqlite-storage');
var ExpoSqliteAdapter = require('./adapters/expo-sqlite-adapter');

/**
 * Compatibility wrapper for ExpoSqliteStorage.
 * This class maintains backward compatibility while internally using
 * SqliteStorage with an ExpoSqliteAdapter.
 * 
 * @deprecated Use SqliteStorage directly with ExpoSqliteAdapter for new code
 * 
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
  options = options || {};
  
  // Create an ExpoSqliteAdapter
  var adapter = new ExpoSqliteAdapter({
    debug: options.debug
  });
  
  // Set up database file name based on namespace (for backward compatibility)
  var namespace = options.namespace || '_DEFAULT';
  var dbName = 'sharedb_' + namespace;
  var dbFileName = options.dbFileName || dbName + '.db';
  
  // Create SqliteStorage with the adapter
  var storageOptions = {
    adapter: adapter,
    dbFileName: dbFileName,
    dbFileDir: options.dbFileDir,
    schemaStrategy: options.schemaStrategy,
    useEncryption: options.useEncryption,
    encryptionCallback: options.encryptionCallback,
    decryptionCallback: options.decryptionCallback,
    debug: options.debug
  };
  
  // Create internal SqliteStorage instance
  this._storage = new SqliteStorage(storageOptions);
  
  // Copy properties for backward compatibility
  this.debug = options.debug || false;
  this.ready = false;
  
  // Store reference to maintain compatibility
  this.db = null;
}

/**
 * Delegate all methods to the internal SqliteStorage instance
 */

ExpoSqliteStorage.prototype.initialize = function(onReadyCallback) {
  var expoStorage = this;
  this._storage.initialize(function(inventory) {
    expoStorage.ready = true;
    expoStorage.db = expoStorage._storage.db;
    onReadyCallback(inventory);
  });
};

ExpoSqliteStorage.prototype.isReady = function() {
  return this._storage.isReady();
};

ExpoSqliteStorage.prototype.ensureReady = function() {
  return this._storage.ensureReady();
};

ExpoSqliteStorage.prototype.writeRecords = function(recordsByType, callback) {
  return this._storage.writeRecords(recordsByType, callback);
};

ExpoSqliteStorage.prototype.readRecord = function(storeName, recordId, callback) {
  return this._storage.readRecord(storeName, recordId, callback);
};

ExpoSqliteStorage.prototype.readAllRecords = function(storeName, callback) {
  return this._storage.readAllRecords(storeName, callback);
};

ExpoSqliteStorage.prototype.deleteRecord = function(storeName, recordId, callback) {
  return this._storage.deleteRecord(storeName, recordId, callback);
};

ExpoSqliteStorage.prototype.updateInventory = function(collection, docId, version, operation, callback) {
  return this._storage.updateInventory(collection, docId, version, operation, callback);
};

ExpoSqliteStorage.prototype.readInventory = function(callback) {
  return this._storage.readInventory(callback);
};

ExpoSqliteStorage.prototype.deleteDatabase = function(callback) {
  return this._storage.deleteDatabase(callback);
};

ExpoSqliteStorage.prototype.log = function(message) {
  return this._storage.log(message);
};

ExpoSqliteStorage.prototype.logError = function(message) {
  return this._storage.logError(message);
};