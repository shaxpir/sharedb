var expect = require('chai').expect;
var StandardSQLiteConnectionPool = require('../../../lib/client/storage/connection-pool/sqlite-connection-pool');
var ExpoSqliteStorage = require('../../../lib/client/storage/expo-sqlite-storage');

describe('Connection Pool Integration', function() {
  var connectionPool, storage;
  var mockConnections = [];
  
  // Mock database factory
  function createMockConnection() {
    var connection = {
      _id: 'conn_' + Math.random().toString(36).substr(2, 9),
      _closed: false,
      
      getFirstAsync: function(sql, params) {
        if (this._closed) {
          return Promise.reject(new Error('Connection closed'));
        }
        
        if (sql === 'SELECT 1 as test') {
          return Promise.resolve({ test: 1 });
        }
        
        return Promise.resolve(null);
      },
      
      getAllAsync: function(sql, params) {
        if (this._closed) {
          return Promise.reject(new Error('Connection closed'));
        }
        
        return Promise.resolve([
          { data: '{"id":"test1","payload":{"text":"hello"}}' },
          { data: '{"id":"test2","payload":{"text":"world"}}' }
        ]);
      },
      
      runAsync: function(sql, params) {
        if (this._closed) {
          return Promise.reject(new Error('Connection closed'));
        }
        
        return Promise.resolve({ changes: 1, lastInsertRowId: 1 });
      },
      
      closeAsync: function() {
        this._closed = true;
        return Promise.resolve();
      }
    };
    
    mockConnections.push(connection);
    return connection;
  }
  
  beforeEach(function() {
    mockConnections = [];
  });
  
  afterEach(function() {
    if (connectionPool) {
      connectionPool.close();
      connectionPool = null;
    }
    if (storage) {
      storage.close();
      storage = null;
    }
  });
  
  describe('StandardSQLiteConnectionPool', function() {
    it('should create and manage connections', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 3,
        minConnections: 1,
        debug: true
      });
      
      // Test basic connection acquisition
      connectionPool.withConnection(function(conn) {
        expect(conn).to.exist;
        expect(conn._id).to.be.a('string');
        return Promise.resolve('test-result');
      }, function(error, result) {
        expect(error).to.be.null;
        expect(result).to.equal('test-result');
        
        // Check pool stats
        var stats = connectionPool.getStats();
        expect(stats.size).to.be.at.least(1);
        expect(stats.connectionsCreated).to.be.at.least(1);
        expect(stats.validationSuccesses).to.be.at.least(0);
        
        done();
      });
    });
    
    it('should validate connections', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 2,
        minConnections: 1
      });
      
      // Get a connection and validate it manually
      connectionPool.getConnection(function(error, conn) {
        expect(error).to.be.null;
        expect(conn).to.exist;
        
        // Test validation method
        connectionPool._validateConnectionWrapper(conn).then(function(isValid) {
          expect(isValid).to.be.true;
          
          // Release connection
          connectionPool.releaseConnection(conn);
          
          // Close connection and test validation again
          conn.closeAsync().then(function() {
            return connectionPool._validateConnectionWrapper(conn);
          }).then(function(isValid) {
            expect(isValid).to.be.false;
            done();
          }).catch(done);
        }).catch(done);
      });
    });
    
    it('should provide comprehensive statistics', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 3,
        minConnections: 1
      });
      
      // Perform several operations to generate stats
      var operations = [];
      for (var i = 0; i < 3; i++) {
        operations.push(new Promise(function(resolve) {
          connectionPool.withConnection(function(conn) {
            return conn.getFirstAsync('SELECT 1 as test');
          }, function(error, result) {
            resolve();
          });
        }));
      }
      
      Promise.all(operations).then(function() {
        var stats = connectionPool.getStats();
        
        expect(stats).to.have.property('size');
        expect(stats).to.have.property('available');
        expect(stats).to.have.property('borrowed');
        expect(stats).to.have.property('connectionsCreated');
        expect(stats).to.have.property('validationSuccesses');
        expect(stats).to.have.property('acquireSuccesses');
        expect(stats).to.have.property('healthScore');
        expect(stats).to.have.property('isHealthy');
        
        expect(stats.connectionsCreated).to.be.at.least(1);
        expect(stats.acquireSuccesses).to.be.at.least(3);
        expect(stats.healthScore).to.be.a('number');
        expect(stats.healthScore).to.be.at.least(0);
        expect(stats.healthScore).to.be.at.most(100);
        
        done();
      }).catch(done);
    });
    
    it('should handle connection failures gracefully', function(done) {
      var createFailure = false;
      
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: function() {
          if (createFailure) {
            throw new Error('Connection creation failed');
          }
          return createMockConnection();
        },
        maxConnections: 2,
        minConnections: 1
      });
      
      // First operation should succeed
      connectionPool.withConnection(function(conn) {
        return Promise.resolve('success');
      }, function(error, result) {
        expect(error).to.be.null;
        expect(result).to.equal('success');
        
        // Now cause creation failures
        createFailure = true;
        
        // This should still work with existing connections
        connectionPool.withConnection(function(conn) {
          return Promise.resolve('still-works');
        }, function(error2, result2) {
          expect(error2).to.be.null;
          expect(result2).to.equal('still-works');
          done();
        });
      });
    });
  });
  
  describe('ExpoSqliteStorage with Connection Pool', function() {
    var mockDb;
    
    beforeEach(function() {
      mockDb = createMockConnection();
    });
    
    it('should accept an injected connection pool', function() {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 3,
        minConnections: 1
      });
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        connectionPool: connectionPool,
        schemaPrefix: 'userdata',
        debug: true
      });
      
      expect(storage.connectionPool).to.equal(connectionPool);
    });
    
    it('should validate connection pool interface', function() {
      var invalidPool = {
        // Missing withConnection method
        getStats: function() { return {}; }
      };
      
      expect(function() {
        storage = new ExpoSqliteStorage({
          database: mockDb,
          connectionPool: invalidPool
        });
      }).to.throw('Connection pool must implement withConnection(operation, callback) method');
    });
    
    it('should use connection pool for cross-database queries', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 2,
        minConnections: 1
      });
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        connectionPool: connectionPool,
        schemaPrefix: 'userdata',
        enableCrossDbQueries: true,
        debug: true
      });
      
      // Skip full initialization and test cross-db query directly
      var query = 'SELECT u.data, p.translation FROM userdata.term u JOIN phrase p ON u.text = p.text';
      
      storage.executeCrossDbQuery(query, [], function(error, results) {
        expect(error).to.be.null;
        expect(results).to.be.an('array');
        expect(results.length).to.equal(2);
        
        // Check that connection pool was used (should have acquired/released connection)
        var poolStats = connectionPool.getStats();
        expect(poolStats.acquireSuccesses).to.be.at.least(1);
        
        done();
      });
    });
    
    it('should provide enhanced stats with connection pool info', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 2,
        minConnections: 1
      });
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        connectionPool: connectionPool,
        schemaPrefix: 'userdata'
      });
      
      // Test stats without full initialization
      storage.getStats(function(error, stats) {
        expect(error).to.be.null;
        expect(stats.hasConnectionPool).to.be.true;
        expect(stats.connectionPool).to.be.an('object');
        expect(stats.connectionPool.size).to.be.a('number');
        expect(stats.connectionPool.healthScore).to.be.a('number');
        
        done();
      });
    });
    
    it('should work with pooled connection operations', function(done) {
      connectionPool = new StandardSQLiteConnectionPool({
        createConnection: createMockConnection,
        maxConnections: 2,
        minConnections: 1
      });
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        connectionPool: connectionPool
      });
      
      storage.withPooledConnection(function(conn) {
        return conn.getFirstAsync('SELECT 1 as test');
      }, function(error, result) {
        expect(error).to.be.null;
        expect(result.test).to.equal(1);
        
        done();
      });
    });
    
    it('should fallback gracefully when no connection pool is provided', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata'
      });
      
      // Should work without connection pool
      storage.withPooledConnection(function(conn) {
        return conn.getFirstAsync('SELECT 1 as test');
      }, function(error, result) {
        expect(error).to.be.null;
        expect(result.test).to.equal(1);
        
        storage.getStats(function(error2, stats) {
          expect(error2).to.be.null;
          expect(stats.hasConnectionPool).to.be.false;
          expect(stats.connectionPool).to.be.undefined;
          
          done();
        });
      });
    });
  });
  
  describe('Connection Pool Interface Compatibility', function() {
    var mockDb;
    
    beforeEach(function() {
      mockDb = createMockConnection();
    });
    
    it('should work with your custom DatabaseConnectionPool interface', function(done) {
      // Simulate your DatabaseConnectionPool interface
      var customPool = {
        withConnection: function(operation, callback) {
          var conn = createMockConnection();
          
          var promise = operation(conn);
          if (promise && typeof promise.then === 'function') {
            promise.then(function(result) {
              callback(null, result);
            }).catch(callback);
          } else {
            callback(null, promise);
          }
        },
        
        getStats: function() {
          return {
            total: 3,
            available: 2,
            inUse: 1
          };
        }
      };
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        connectionPool: customPool,
        debug: true
      });
      
      expect(storage.connectionPool).to.equal(customPool);
      
      // Test that it works
      storage.withPooledConnection(function(conn) {
        return conn.getFirstAsync('SELECT 1 as test');
      }, function(error, result) {
        expect(error).to.be.null;
        expect(result.test).to.equal(1);
        done();
      });
    });
    
    it('should work with any pool implementing withConnection interface', function() {
      var simplePool = {
        withConnection: function(operation, callback) {
          // Minimal implementation
          callback(null, 'pool-result');
        }
      };
      
      expect(function() {
        storage = new ExpoSqliteStorage({
          database: mockDb,
          connectionPool: simplePool
        });
      }).to.not.throw();
      
      expect(storage.connectionPool).to.equal(simplePool);
    });
  });
});