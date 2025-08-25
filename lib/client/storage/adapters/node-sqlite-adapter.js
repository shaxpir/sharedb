var BaseSqliteAdapter = require('./base-sqlite-adapter');
var logger = require('../../../logger');
var path = require('path');
var fs = require('fs');

/**
 * SQLite adapter for Node.js using better-sqlite3 or sqlite3.
 * This adapter allows testing the storage implementations in Node.js
 * without requiring a React Native environment.
 * 
 * Supports both:
 * - better-sqlite3 (synchronous, faster, recommended)
 * - sqlite3 (async, more widely compatible)
 */
module.exports = NodeSqliteAdapter;
function NodeSqliteAdapter(options) {
  BaseSqliteAdapter.call(this, options);
  
  // Try to load better-sqlite3 first, fall back to sqlite3
  this.implementation = null;
  this.Database = null;
  
  try {
    this.Database = require('better-sqlite3');
    this.implementation = 'better-sqlite3';
    this.debug && logger.info('NodeSqliteAdapter: Using better-sqlite3');
  } catch (e1) {
    try {
      this.Database = require('sqlite3').Database;
      this.implementation = 'sqlite3';
      this.debug && logger.info('NodeSqliteAdapter: Using sqlite3');
    } catch (e2) {
      throw new Error('NodeSqliteAdapter requires either better-sqlite3 or sqlite3 npm package');
    }
  }
}

// Inherit from BaseSqliteAdapter
NodeSqliteAdapter.prototype = Object.create(BaseSqliteAdapter.prototype);
NodeSqliteAdapter.prototype.constructor = NodeSqliteAdapter;

/**
 * Open a database connection
 */
NodeSqliteAdapter.prototype.openDatabase = function(dbFileName, options, dbFileDir, callback) {
  var adapter = this;
  
  // Construct full path if directory is provided
  var dbPath = dbFileName;
  if (dbFileDir) {
    // Ensure directory exists
    if (!fs.existsSync(dbFileDir)) {
      fs.mkdirSync(dbFileDir, { recursive: true });
    }
    dbPath = path.join(dbFileDir, dbFileName);
  }
  
  if (this.implementation === 'better-sqlite3') {
    // better-sqlite3 is synchronous
    try {
      this.db = new this.Database(dbPath);
      
      // Enable foreign keys
      this.db.exec('PRAGMA foreign_keys = ON');
      
      this.debug && logger.info('NodeSqliteAdapter: Opened database ' + dbPath);
      
      // Call callback asynchronously for consistency
      setTimeout(function() {
        callback && callback(null, adapter.db);
      }, 0);
    } catch (error) {
      setTimeout(function() {
        callback && callback(error, null);
      }, 0);
    }
  } else {
    // sqlite3 is asynchronous
    this.db = new this.Database(dbPath, function(error) {
      if (error) {
        callback && callback(error, null);
        return;
      }
      
      // Enable foreign keys
      adapter.db.run('PRAGMA foreign_keys = ON', function(err) {
        adapter.debug && logger.info('NodeSqliteAdapter: Opened database ' + dbPath);
        callback && callback(err, adapter.db);
      });
    });
  }
};

/**
 * Close the database connection
 */
NodeSqliteAdapter.prototype.closeDatabase = function(callback) {
  if (!this.db) {
    callback && callback();
    return;
  }
  
  if (this.implementation === 'better-sqlite3') {
    try {
      this.db.close();
      this.db = null;
      this.debug && logger.info('NodeSqliteAdapter: Closed database');
      callback && callback();
    } catch (error) {
      callback && callback(error);
    }
  } else {
    this.db.close(function(error) {
      this.db = null;
      this.debug && logger.info('NodeSqliteAdapter: Closed database');
      callback && callback(error);
    });
  }
};

/**
 * Run a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)
 */
NodeSqliteAdapter.prototype.run = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  if (this.implementation === 'better-sqlite3') {
    try {
      var stmt = this.db.prepare(sql);
      var result = stmt.run(params || []);
      
      adapter.debug && logger.info('NodeSqliteAdapter: Executed SQL: ' + sql.substring(0, 50));
      
      // Convert better-sqlite3 result to match expo-sqlite format
      callback && callback(null, {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowid
      });
    } catch (error) {
      adapter.debug && logger.error('NodeSqliteAdapter: SQL error: ' + error.message);
      callback && callback(error, null);
    }
  } else {
    this.db.run(sql, params || [], function(error) {
      if (error) {
        adapter.debug && logger.error('NodeSqliteAdapter: SQL error: ' + error.message);
        callback && callback(error, null);
      } else {
        adapter.debug && logger.info('NodeSqliteAdapter: Executed SQL: ' + sql.substring(0, 50));
        callback && callback(null, {
          changes: this.changes,
          lastInsertRowId: this.lastID
        });
      }
    });
  }
};

/**
 * Get a single row from a SELECT query
 */
NodeSqliteAdapter.prototype.get = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  if (this.implementation === 'better-sqlite3') {
    try {
      var stmt = this.db.prepare(sql);
      var row = stmt.get(params || []);
      
      adapter.debug && logger.info('NodeSqliteAdapter: Got row from: ' + sql.substring(0, 50));
      callback && callback(null, row);
    } catch (error) {
      adapter.debug && logger.error('NodeSqliteAdapter: Query error: ' + error.message);
      callback && callback(error, null);
    }
  } else {
    this.db.get(sql, params || [], function(error, row) {
      if (error) {
        adapter.debug && logger.error('NodeSqliteAdapter: Query error: ' + error.message);
        callback && callback(error, null);
      } else {
        adapter.debug && logger.info('NodeSqliteAdapter: Got row from: ' + sql.substring(0, 50));
        callback && callback(null, row);
      }
    });
  }
};

/**
 * Get all rows from a SELECT query
 */
NodeSqliteAdapter.prototype.all = function(sql, params, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  if (this.implementation === 'better-sqlite3') {
    try {
      var stmt = this.db.prepare(sql);
      var rows = stmt.all(params || []);
      
      adapter.debug && logger.info('NodeSqliteAdapter: Got ' + rows.length + ' rows from: ' + sql.substring(0, 50));
      callback && callback(null, rows);
    } catch (error) {
      adapter.debug && logger.error('NodeSqliteAdapter: Query error: ' + error.message);
      callback && callback(error, null);
    }
  } else {
    this.db.all(sql, params || [], function(error, rows) {
      if (error) {
        adapter.debug && logger.error('NodeSqliteAdapter: Query error: ' + error.message);
        callback && callback(error, null);
      } else {
        adapter.debug && logger.info('NodeSqliteAdapter: Got ' + rows.length + ' rows from: ' + sql.substring(0, 50));
        callback && callback(null, rows);
      }
    });
  }
};

/**
 * Execute multiple SQL statements in a transaction
 */
NodeSqliteAdapter.prototype.transaction = function(transactionFn, callback) {
  var adapter = this;
  
  if (!this.db) {
    callback && callback(new Error('Database not open'));
    return;
  }
  
  if (this.implementation === 'better-sqlite3') {
    // better-sqlite3 has built-in transaction support
    var transaction = this.db.transaction(function() {
      var error = null;
      var result = null;
      
      // Create a wrapper that captures results synchronously
      transactionFn(adapter, function(err, res) {
        error = err;
        result = res;
      });
      
      if (error) {
        throw error;
      }
      return result;
    });
    
    try {
      var result = transaction();
      callback && callback(null, result);
    } catch (error) {
      callback && callback(error, null);
    }
  } else {
    // sqlite3 requires manual transaction management
    this.db.serialize(function() {
      adapter.db.run('BEGIN TRANSACTION', function(error) {
        if (error) {
          callback && callback(error, null);
          return;
        }
        
        transactionFn(adapter, function(err, result) {
          if (err) {
            adapter.db.run('ROLLBACK', function() {
              callback && callback(err, null);
            });
          } else {
            adapter.db.run('COMMIT', function(commitError) {
              callback && callback(commitError, result);
            });
          }
        });
      });
    });
  }
};

/**
 * Prepare a statement for repeated execution
 */
NodeSqliteAdapter.prototype.prepare = function(sql) {
  if (!this.db) {
    throw new Error('Database not open');
  }
  
  if (this.implementation === 'better-sqlite3') {
    return this.db.prepare(sql);
  } else {
    // sqlite3 doesn't expose prepare in the same way
    return { sql: sql };
  }
};

/**
 * Get adapter type
 */
NodeSqliteAdapter.prototype.getType = function() {
  return 'node-sqlite (' + this.implementation + ')';
};