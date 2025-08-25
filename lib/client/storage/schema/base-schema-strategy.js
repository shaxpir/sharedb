/**
 * Base class for SQLite schema strategies.
 * Schema strategies define how data is organized in SQLite tables,
 * how encryption is applied, and how queries are optimized.
 * 
 * All schema strategies must extend this base class and implement
 * the required methods.
 */
module.exports = BaseSchemaStrategy;
function BaseSchemaStrategy(options) {
  this.options = options || {};
  this.debug = this.options.debug || false;
}

/**
 * Initialize the schema (create tables, indexes, etc.)
 * @param {Object} db - SQLite database instance
 * @param {Function} callback - Called when initialization is complete
 */
BaseSchemaStrategy.prototype.initializeSchema = function(db, callback) {
  throw new Error('initializeSchema must be implemented by subclass');
};

/**
 * Validate that the schema exists and is compatible
 * @param {Object} db - SQLite database instance
 * @param {Function} callback - Called with (error, isValid)
 */
BaseSchemaStrategy.prototype.validateSchema = function(db, callback) {
  throw new Error('validateSchema must be implemented by subclass');
};

/**
 * Get the table name for a given collection
 * @param {String} collection - Collection name
 * @returns {String} Table name to use
 */
BaseSchemaStrategy.prototype.getTableName = function(collection) {
  throw new Error('getTableName must be implemented by subclass');
};

/**
 * Write records to the database
 * @param {Object} db - SQLite database instance
 * @param {Object} recordsByType - Object with 'docs' and/or 'meta' arrays
 * @param {Function} callback - Called when write is complete
 */
BaseSchemaStrategy.prototype.writeRecords = function(db, recordsByType, callback) {
  throw new Error('writeRecords must be implemented by subclass');
};

/**
 * Read a single record from the database
 * @param {Object} db - SQLite database instance
 * @param {String} type - 'docs' or 'meta'
 * @param {String} collection - Collection name (null for meta)
 * @param {String} id - Record ID
 * @param {Function} callback - Called with (error, record)
 */
BaseSchemaStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  throw new Error('readRecord must be implemented by subclass');
};

/**
 * Read all records of a given type
 * @param {Object} db - SQLite database instance
 * @param {String} type - 'docs' or 'meta'
 * @param {String} collection - Collection name (null for meta or all docs)
 * @param {Function} callback - Called with (error, records)
 */
BaseSchemaStrategy.prototype.readAllRecords = function(db, type, collection, callback) {
  throw new Error('readAllRecords must be implemented by subclass');
};

/**
 * Delete a record from the database
 * @param {Object} db - SQLite database instance
 * @param {String} type - 'docs' or 'meta'
 * @param {String} collection - Collection name (null for meta)
 * @param {String} id - Record ID
 * @param {Function} callback - Called when deletion is complete
 */
BaseSchemaStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  throw new Error('deleteRecord must be implemented by subclass');
};

/**
 * Determine if a specific field should be encrypted
 * @param {String} collection - Collection name
 * @param {String} fieldPath - Dot-notation path to field
 * @returns {Boolean} True if field should be encrypted
 */
BaseSchemaStrategy.prototype.shouldEncryptField = function(collection, fieldPath) {
  // Default: no field-level encryption
  return false;
};

/**
 * Apply encryption strategy to a record
 * @param {Object} record - Record to encrypt
 * @param {String} collection - Collection name
 * @param {Function} encryptCallback - Encryption function
 * @returns {Object} Encrypted record
 */
BaseSchemaStrategy.prototype.encryptRecord = function(record, collection, encryptCallback) {
  // Default implementation: encrypt entire payload if encryption is enabled
  if (!encryptCallback) return record;
  
  return {
    id: record.id,
    encrypted_payload: encryptCallback(JSON.stringify(record.payload))
  };
};

/**
 * Apply decryption strategy to a record
 * @param {Object} record - Record to decrypt
 * @param {String} collection - Collection name
 * @param {Function} decryptCallback - Decryption function
 * @returns {Object} Decrypted record
 */
BaseSchemaStrategy.prototype.decryptRecord = function(record, collection, decryptCallback) {
  // Default implementation: decrypt entire payload if encrypted
  if (!decryptCallback || !record.encrypted_payload) return record;
  
  return {
    id: record.id,
    payload: JSON.parse(decryptCallback(record.encrypted_payload))
  };
};

/**
 * Create indexes for optimized queries
 * @param {Object} db - SQLite database instance
 * @param {String} collection - Collection name
 * @param {Function} callback - Called when indexes are created
 */
BaseSchemaStrategy.prototype.createIndexes = function(db, collection, callback) {
  // Default: no additional indexes
  callback && callback();
};

/**
 * Migrate schema from one version to another
 * @param {Object} db - SQLite database instance
 * @param {Number} fromVersion - Current schema version
 * @param {Number} toVersion - Target schema version
 * @param {Function} callback - Called when migration is complete
 */
BaseSchemaStrategy.prototype.migrateSchema = function(db, fromVersion, toVersion, callback) {
  // Default: no migration needed
  callback && callback();
};

/**
 * Initialize the inventory storage
 * @param {Object} db - SQLite database instance
 * @param {Function} callback - Called with (error, inventory)
 */
BaseSchemaStrategy.prototype.initializeInventory = function(db, callback) {
  throw new Error('initializeInventory must be implemented by subclass');
};

/**
 * Read the entire inventory
 * @param {Object} db - SQLite database instance
 * @param {Function} callback - Called with (error, inventory)
 */
BaseSchemaStrategy.prototype.readInventory = function(db, callback) {
  throw new Error('readInventory must be implemented by subclass');
};

/**
 * Update inventory for a specific collection/document
 * @param {Object} db - SQLite database instance
 * @param {String} collection - Collection name
 * @param {String} docId - Document ID
 * @param {Number} version - Document version
 * @param {String} operation - 'add', 'update', or 'remove'
 * @param {Function} callback - Called when update is complete
 */
BaseSchemaStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  throw new Error('updateInventoryItem must be implemented by subclass');
};

/**
 * Get inventory representation type
 * @returns {String} 'json' for single JSON doc, 'table' for table-based
 */
BaseSchemaStrategy.prototype.getInventoryType = function() {
  throw new Error('getInventoryType must be implemented by subclass');
};