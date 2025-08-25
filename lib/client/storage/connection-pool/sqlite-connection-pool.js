var createPool = require('generic-pool').createPool;
var logger = require('../../../logger');

/**
 * StandardSQLiteConnectionPool - Production-ready connection pool for SQLite databases
 * 
 * Uses the battle-tested generic-pool library to manage SQLite connections.
 * Designed for React Native environments with expo-sqlite, but works with any 
 * SQLite implementation that follows the async/await pattern.
 * 
 * Features:
 * - Automatic connection validation and cleanup
 * - Configurable pool size and timeouts
 * - Resource leak prevention
 * - Comprehensive statistics and health monitoring
 * - Integration with ShareDB storage adapters
 */
function StandardSQLiteConnectionPool(options) {
  if (!options || typeof options.createConnection !== 'function') {
    throw new Error('StandardSQLiteConnectionPool requires a createConnection function');
  }
  
  this.options = options;
  this.debug = options.debug || false;
  this.createConnection = options.createConnection;
  this.destroyConnection = options.destroyConnection || this._defaultDestroyConnection;
  this.validateConnection = options.validateConnection || this._defaultValidateConnection;
  
  // Pool configuration
  var poolOptions = {
    max: options.maxConnections || 5,           // Maximum connections
    min: options.minConnections || 2,           // Minimum connections
    acquireTimeoutMillis: options.acquireTimeout || 5000,    // 5 second timeout
    createTimeoutMillis: options.createTimeout || 10000,     // 10 second create timeout
    destroyTimeoutMillis: options.destroyTimeout || 5000,    // 5 second destroy timeout
    idleTimeoutMillis: options.idleTimeout || 30000,         // 30 second idle timeout
    reapIntervalMillis: options.reapInterval || 1000,        // Check every second
    
    // Validation options
    testOnBorrow: options.testOnBorrow !== false,    // Default: true
    testOnReturn: options.testOnReturn !== false,    // Default: true
    
    // Error handling
    autostart: true,
    evictionRunIntervalMillis: options.evictionInterval || 5000
  };
  
  // Create the pool factory
  var factory = {
    create: this._createConnectionWrapper.bind(this),
    destroy: this._destroyConnectionWrapper.bind(this),
    validate: this._validateConnectionWrapper.bind(this)
  };
  
  this.pool = createPool(factory, poolOptions);
  this._stats = {
    connectionsCreated: 0,
    connectionsDestroyed: 0,
    validationSuccesses: 0,
    validationFailures: 0,
    acquireSuccesses: 0,
    acquireFailures: 0
  };
  
  this.debug && logger.info('StandardSQLiteConnectionPool: Initialized with ' + JSON.stringify(poolOptions));
}

/**
 * Factory method to create a new database connection
 */
StandardSQLiteConnectionPool.prototype._createConnectionWrapper = function() {
  var self = this;
  return Promise.resolve().then(function() {
    self.debug && logger.info('StandardSQLiteConnectionPool: Creating new connection');
    return self.createConnection();
  }).then(function(connection) {
    self._stats.connectionsCreated++;
    self.debug && logger.info('StandardSQLiteConnectionPool: Connection created successfully');
    return connection;
  }).catch(function(error) {
    self.debug && logger.error('StandardSQLiteConnectionPool: Failed to create connection: ' + error.message);
    throw error;
  });
};

/**
 * Factory method to destroy a database connection
 */
StandardSQLiteConnectionPool.prototype._destroyConnectionWrapper = function(connection) {
  var self = this;
  return Promise.resolve().then(function() {
    self.debug && logger.info('StandardSQLiteConnectionPool: Destroying connection');
    return self.destroyConnection(connection);
  }).then(function() {
    self._stats.connectionsDestroyed++;
    self.debug && logger.info('StandardSQLiteConnectionPool: Connection destroyed successfully');
  }).catch(function(error) {
    self.debug && logger.error('StandardSQLiteConnectionPool: Failed to destroy connection: ' + error.message);
    // Don't re-throw - we want to mark the connection as destroyed even if cleanup failed
  });
};

/**
 * Factory method to validate a database connection
 */
StandardSQLiteConnectionPool.prototype._validateConnectionWrapper = function(connection) {
  var self = this;
  return Promise.resolve().then(function() {
    return self.validateConnection(connection);
  }).then(function(isValid) {
    if (isValid) {
      self._stats.validationSuccesses++;
      self.debug && logger.info('StandardSQLiteConnectionPool: Connection validation passed');
    } else {
      self._stats.validationFailures++;
      self.debug && logger.info('StandardSQLiteConnectionPool: Connection validation failed');
    }
    return isValid;
  }).catch(function(error) {
    self._stats.validationFailures++;
    self.debug && logger.error('StandardSQLiteConnectionPool: Connection validation error: ' + error.message);
    return false;
  });
};

/**
 * Default connection destroyer - calls closeAsync if available
 */
StandardSQLiteConnectionPool.prototype._defaultDestroyConnection = function(connection) {
  if (connection && typeof connection.closeAsync === 'function') {
    return connection.closeAsync();
  }
  return Promise.resolve();
};

/**
 * Default connection validator - tries to execute a simple query
 */
StandardSQLiteConnectionPool.prototype._defaultValidateConnection = function(connection) {
  if (!connection) {
    return Promise.resolve(false);
  }
  
  // Try different query methods based on the connection type
  if (typeof connection.getFirstAsync === 'function') {
    return connection.getFirstAsync('SELECT 1 as test').then(function(row) {
      return row && row.test === 1;
    }).catch(function() {
      return false;
    });
  }
  
  if (typeof connection.execAsync === 'function') {
    return connection.execAsync('SELECT 1').then(function() {
      return true;
    }).catch(function() {
      return false;
    });
  }
  
  // If no known query method, assume valid
  return Promise.resolve(true);
};

/**
 * Execute an operation with a connection from the pool
 * This is the main method for using the pool
 */
StandardSQLiteConnectionPool.prototype.withConnection = function(operation, callback) {
  var self = this;
  var connection = null;
  
  // Support both callback and promise patterns
  if (typeof callback === 'function') {
    self.pool.acquire().then(function(conn) {
      connection = conn;
      self._stats.acquireSuccesses++;
      return operation(connection);
    }).then(function(result) {
      callback(null, result);
    }).catch(function(error) {
      self._stats.acquireFailures++;
      callback(error);
    }).finally(function() {
      if (connection) {
        self.pool.release(connection);
      }
    });
  } else {
    // Return a promise
    return self.pool.acquire().then(function(conn) {
      connection = conn;
      self._stats.acquireSuccesses++;
      return operation(connection);
    }).catch(function(error) {
      self._stats.acquireFailures++;
      throw error;
    }).finally(function() {
      if (connection) {
        self.pool.release(connection);
      }
    });
  }
};

/**
 * Get a connection from the pool (manual management)
 * NOTE: You MUST call releaseConnection() when done!
 */
StandardSQLiteConnectionPool.prototype.getConnection = function(callback) {
  var self = this;
  
  if (typeof callback === 'function') {
    self.pool.acquire().then(function(connection) {
      self._stats.acquireSuccesses++;
      callback(null, connection);
    }).catch(function(error) {
      self._stats.acquireFailures++;
      callback(error);
    });
  } else {
    return self.pool.acquire().then(function(connection) {
      self._stats.acquireSuccesses++;
      return connection;
    }).catch(function(error) {
      self._stats.acquireFailures++;
      throw error;
    });
  }
};

/**
 * Release a connection back to the pool
 */
StandardSQLiteConnectionPool.prototype.releaseConnection = function(connection) {
  this.pool.release(connection);
};

/**
 * Get comprehensive pool statistics
 */
StandardSQLiteConnectionPool.prototype.getStats = function() {
  return {
    // Pool state
    size: this.pool.size,               // Total connections created
    available: this.pool.available,     // Available connections
    borrowed: this.pool.borrowed,       // Connections currently in use
    invalid: this.pool.invalid,         // Invalid connections
    pending: this.pool.pending,         // Pending connection requests
    
    // Lifecycle stats
    connectionsCreated: this._stats.connectionsCreated,
    connectionsDestroyed: this._stats.connectionsDestroyed,
    
    // Validation stats
    validationSuccesses: this._stats.validationSuccesses,
    validationFailures: this._stats.validationFailures,
    
    // Usage stats
    acquireSuccesses: this._stats.acquireSuccesses,
    acquireFailures: this._stats.acquireFailures,
    
    // Health indicators
    healthScore: this._calculateHealthScore(),
    isHealthy: this._isHealthy()
  };
};

/**
 * Calculate a health score (0-100) based on pool metrics
 */
StandardSQLiteConnectionPool.prototype._calculateHealthScore = function() {
  var stats = this._stats;
  var totalValidations = stats.validationSuccesses + stats.validationFailures;
  var totalAcquisitions = stats.acquireSuccesses + stats.acquireFailures;
  
  var validationScore = totalValidations > 0 ? (stats.validationSuccesses / totalValidations) * 100 : 100;
  var acquisitionScore = totalAcquisitions > 0 ? (stats.acquireSuccesses / totalAcquisitions) * 100 : 100;
  
  // Pool utilization (0-50 points, with 50% utilization being optimal)
  var utilizationScore = 0;
  if (this.pool.size > 0) {
    var utilization = this.pool.borrowed / this.pool.size;
    utilizationScore = utilization <= 0.5 ? utilization * 100 : (1 - utilization) * 100;
  }
  
  return Math.round((validationScore * 0.4) + (acquisitionScore * 0.4) + (utilizationScore * 0.2));
};

/**
 * Check if the pool is healthy
 */
StandardSQLiteConnectionPool.prototype._isHealthy = function() {
  var healthScore = this._calculateHealthScore();
  var hasConnections = this.pool.size > 0;
  var notOverloaded = this.pool.pending < this.pool.size;
  
  return healthScore >= 80 && hasConnections && notOverloaded;
};

/**
 * Drain and close the pool
 */
StandardSQLiteConnectionPool.prototype.close = function(callback) {
  var self = this;
  
  self.debug && logger.info('StandardSQLiteConnectionPool: Closing pool...');
  
  if (typeof callback === 'function') {
    self.pool.drain().then(function() {
      return self.pool.clear();
    }).then(function() {
      self.debug && logger.info('StandardSQLiteConnectionPool: Pool closed successfully');
      callback();
    }).catch(function(error) {
      self.debug && logger.error('StandardSQLiteConnectionPool: Error closing pool: ' + error.message);
      callback(error);
    });
  } else {
    return self.pool.drain().then(function() {
      return self.pool.clear();
    }).then(function() {
      self.debug && logger.info('StandardSQLiteConnectionPool: Pool closed successfully');
    }).catch(function(error) {
      self.debug && logger.error('StandardSQLiteConnectionPool: Error closing pool: ' + error.message);
      throw error;
    });
  }
};

/**
 * Check if the pool is ready
 */
StandardSQLiteConnectionPool.prototype.isReady = function() {
  return this.pool.size >= this.options.minConnections;
};

module.exports = StandardSQLiteConnectionPool;