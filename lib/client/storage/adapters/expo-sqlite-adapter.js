var BaseSqliteAdapter = require('./base-sqlite-adapter');
var logger = require('../../../logger');

/**
 * SQLite adapter for React Native using expo-sqlite.
 * This adapter wraps the expo-sqlite API to work with our storage abstraction.
 * Supports both file-based databases and pre-initialized database connections.
 */
module.exports = ExpoSqliteAdapter;
function ExpoSqliteAdapter(options) {
  BaseSqliteAdapter.call(this, options);
  
  options = options || {};
  
  // Accept pre-initialized database connection
  this.preInitializedDb = options.database;
  
  // Check if expo-sqlite is available (only if we need to create a new database)
  if (!this.preInitializedDb) {
    try {
      this.SQLite = require('expo-sqlite');
      if (!this.SQLite) {
        throw new Error('expo-sqlite module not found');
      }
    } catch (e) {
      throw new Error('ExpoSqliteAdapter requires expo-sqlite: ' + e.message);
    }
  }
}

// Inherit from BaseSqliteAdapter
ExpoSqliteAdapter.prototype = Object.create(BaseSqliteAdapter.prototype);
ExpoSqliteAdapter.prototype.constructor = ExpoSqliteAdapter;

/**
 * Open a database connection using expo-sqlite or use pre-initialized database
 */
ExpoSqliteAdapter.prototype.openDatabase = function(dbFileName, options, dbFileDir, callback) {
  var adapter = this;
  
  // Use pre-initialized database if provided
  if (this.preInitializedDb) {
    this.db = this.preInitializedDb;
    this.debug && logger.info('ExpoSqliteAdapter: Using pre-initialized database');
    
    setTimeout(function() {
      callback && callback(null, adapter.db);
    }, 0);
    return;
  }
  
  // Create new database file
  try {
    // expo-sqlite uses openDatabaseSync for synchronous opening
    var dbOptions = options || { useNewConnection: true };
    this.db = this.SQLite.openDatabaseSync(dbFileName, dbOptions, dbFileDir);
    
    this.debug && logger.info('ExpoSqliteAdapter: Opened database ' + dbFileName);
    
    // Call callback asynchronously for consistency
    setTimeout(function() {
      callback && callback(null, adapter.db);
    }, 0);
  } catch (error) {
    setTimeout(function() {
      callback && callback(error, null);
    }, 0);
  }
};

/**
 * Close the database connection
 */
ExpoSqliteAdapter.prototype.closeDatabase = function(callback) {
  // Don't close pre-initialized databases (they're managed externally)
  if (this.preInitializedDb) {
    this.debug && logger.info('ExpoSqliteAdapter: Skipping close of pre-initialized database');
    this.db = null;
    callback && callback();
    return;
  }
  
  // Close databases we created
  if (this.db && this.db.closeAsync) {
    var adapter = this;
    this.db.closeAsync().then(function() {
      adapter.db = null;
      adapter.debug && logger.info('ExpoSqliteAdapter: Closed database');
      callback && callback();
    }).catch(function(error) {
      callback && callback(error);
    });
  } else {
    this.db = null;
    callback && callback();
  }
};

/**
 * Run a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 */
ExpoSqliteAdapter.prototype.run = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  // expo-sqlite uses runAsync for write operations
  this.db.runAsync(sql, params || []).then(function(result) {
    adapter.debug && logger.info('ExpoSqliteAdapter: Executed SQL: ' + sql.substring(0, 50));
    callback && callback(null, result);
  }).catch(function(error) {
    adapter.debug && logger.error('ExpoSqliteAdapter: SQL error: ' + error.message);
    callback && callback(error, null);
  });
};

/**
 * Get a single row from a SELECT query
 */
ExpoSqliteAdapter.prototype.get = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  // expo-sqlite uses getFirstAsync for single row queries
  this.db.getFirstAsync(sql, params || []).then(function(row) {
    adapter.debug && logger.info('ExpoSqliteAdapter: Got row from: ' + sql.substring(0, 50));
    callback && callback(null, row);
  }).catch(function(error) {
    adapter.debug && logger.error('ExpoSqliteAdapter: Query error: ' + error.message);
    callback && callback(error, null);
  });
};

/**
 * Get all rows from a SELECT query
 */
ExpoSqliteAdapter.prototype.all = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  // expo-sqlite uses getAllAsync for multiple row queries
  this.db.getAllAsync(sql, params || []).then(function(rows) {
    adapter.debug && logger.info('ExpoSqliteAdapter: Got ' + rows.length + ' rows from: ' + sql.substring(0, 50));
    callback && callback(null, rows);
  }).catch(function(error) {
    adapter.debug && logger.error('ExpoSqliteAdapter: Query error: ' + error.message);
    callback && callback(error, null);
  });
};

/**
 * Execute multiple SQL statements in a transaction
 */
ExpoSqliteAdapter.prototype.transaction = function(transactionFn, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  // expo-sqlite uses withTransactionAsync
  if (this.db.withTransactionAsync) {
    this.db.withTransactionAsync(function() {
      return new Promise(function(resolve, reject) {
        transactionFn(adapter, function(error, result) {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
    }).then(function(result) {
      callback && callback(null, result);
    }).catch(function(error) {
      callback && callback(error, null);
    });
  } else {
    // Fallback: execute without explicit transaction
    transactionFn(this, callback);
  }
};

/**
 * Get adapter type
 */
ExpoSqliteAdapter.prototype.getType = function() {
  return 'expo-sqlite';
};