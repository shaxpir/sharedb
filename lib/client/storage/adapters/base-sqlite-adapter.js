/**
 * Base class for SQLite database adapters.
 * This abstraction allows the same storage code to work with different SQLite implementations:
 * - better-sqlite3 or sqlite3 for Node.js
 * 
 * All database operations are callback-based for consistency with ShareDB patterns.
 */
module.exports = BaseSqliteAdapter;
function BaseSqliteAdapter(options) {
  this.options = options || {};
  this.debug = this.options.debug || false;
  this.db = null;
}

/**
 * Open a database connection
 * @param {String} dbFileName - Database file name
 * @param {Object} options - Implementation-specific options
 * @param {String} dbFileDir - Optional directory for database file
 * @param {Function} callback - Called with (error, db)
 */
BaseSqliteAdapter.prototype.openDatabase = function(dbFileName, options, dbFileDir, callback) {
  throw new Error('openDatabase must be implemented by subclass');
};

/**
 * Close the database connection
 * @param {Function} callback - Called when closed
 */
BaseSqliteAdapter.prototype.closeDatabase = function(callback) {
  throw new Error('closeDatabase must be implemented by subclass');
};

/**
 * Run a SQL statement that doesn't return data (INSERT, UPDATE, DELETE, CREATE, etc.)
 * @param {String} sql - SQL statement
 * @param {Array} params - Parameters for the SQL statement
 * @param {Function} callback - Called with (error, result)
 */
BaseSqliteAdapter.prototype.run = function(sql, params, callback) {
  throw new Error('run must be implemented by subclass');
};

/**
 * Get a single row from a SELECT query
 * @param {String} sql - SQL statement
 * @param {Array} params - Parameters for the SQL statement
 * @param {Function} callback - Called with (error, row)
 */
BaseSqliteAdapter.prototype.get = function(sql, params, callback) {
  throw new Error('get must be implemented by subclass');
};

/**
 * Get all rows from a SELECT query
 * @param {String} sql - SQL statement
 * @param {Array} params - Parameters for the SQL statement
 * @param {Function} callback - Called with (error, rows)
 */
BaseSqliteAdapter.prototype.all = function(sql, params, callback) {
  throw new Error('all must be implemented by subclass');
};

/**
 * Execute multiple SQL statements in a transaction
 * @param {Function} transactionFn - Function that performs the transaction operations
 * @param {Function} callback - Called with (error, result)
 */
BaseSqliteAdapter.prototype.transaction = function(transactionFn, callback) {
  throw new Error('transaction must be implemented by subclass');
};

/**
 * Prepare a statement for repeated execution (optional optimization)
 * @param {String} sql - SQL statement to prepare
 * @returns {Object} Prepared statement object
 */
BaseSqliteAdapter.prototype.prepare = function(sql) {
  // Default implementation: just return the SQL
  // Subclasses can override for better performance
  return { sql: sql };
};

/**
 * Check if the adapter is ready for operations
 * @returns {Boolean} True if ready
 */
BaseSqliteAdapter.prototype.isReady = function() {
  return this.db !== null;
};

/**
 * Get adapter type for debugging/logging
 * @returns {String} Adapter type name
 */
BaseSqliteAdapter.prototype.getType = function() {
  throw new Error('getType must be implemented by subclass');
};