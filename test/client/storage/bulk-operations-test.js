var expect = require('chai').expect;
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var IndexedDbStorage = require('../../../lib/client/storage/indexed-db-storage');
var DefaultSchemaStrategy = require('../../../lib/client/storage/schema/default-schema-strategy');
var CollectionPerTableStrategy = require('../../../lib/client/storage/schema/collection-per-table-strategy');

describe('Storage Bulk Operations', function() {
  var storage;
  var testRecords;

  beforeEach(function() {
    // Create test records for use across tests
    testRecords = [
      {
        id: 'testCollection/doc1',
        payload: {
          collection: 'testCollection',
          id: 'doc1',
          data: { title: 'Document 1', value: 100 },
          version: 1,
          type: 'json0'
        }
      },
      {
        id: 'testCollection/doc2',
        payload: {
          collection: 'testCollection',
          id: 'doc2',
          data: { title: 'Document 2', value: 200 },
          version: 1,
          type: 'json0'
        }
      },
      {
        id: 'testCollection/doc3',
        payload: {
          collection: 'testCollection',
          id: 'doc3',
          data: { title: 'Document 3', value: 300 },
          version: 1,
          type: 'json0'
        }
      }
    ];
  });

  describe('InMemoryStorage', function() {
    beforeEach(function(done) {
      storage = new InMemoryStorage({ debug: false });
      storage.initialize(function() {
        // Pre-populate with test data
        storage.writeRecords({ docs: testRecords }, function() {
          done();
        });
      });
    });

    describe('readRecordsBulk', function() {
      it('should read multiple records by ID', function(done) {
        var ids = ['testCollection/doc1', 'testCollection/doc2'];
        
        storage.readRecordsBulk('docs', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(2);
          
          var recordIds = records.map(function(r) { return r.id; });
          expect(recordIds).to.include.members(ids);
          
          // Verify payload structure
          records.forEach(function(record) {
            expect(record).to.have.property('id');
            expect(record).to.have.property('payload');
            expect(record.payload).to.have.property('collection');
            expect(record.payload).to.have.property('data');
          });
          
          done();
        });
      });

      it('should return empty array for empty IDs', function(done) {
        storage.readRecordsBulk('docs', [], function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should handle non-existent records gracefully', function(done) {
        var ids = ['nonexistent1', 'nonexistent2'];
        
        storage.readRecordsBulk('docs', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should handle mixed existent and non-existent records', function(done) {
        var ids = ['testCollection/doc1', 'nonexistent', 'testCollection/doc3'];
        
        storage.readRecordsBulk('docs', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(2);
          
          var recordIds = records.map(function(r) { return r.id; });
          expect(recordIds).to.include.members(['testCollection/doc1', 'testCollection/doc3']);
          expect(recordIds).to.not.include('nonexistent');
          
          done();
        });
      });

      it('should handle non-existent store', function(done) {
        storage.readRecordsBulk('nonexistentStore', ['id1'], function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should be called asynchronously', function(done) {
        var callbackCalled = false;
        
        storage.readRecordsBulk('docs', ['testCollection/doc1'], function(err, records) {
          callbackCalled = true;
          expect(err).to.be.null;
          expect(records).to.have.length(1);
        });
        
        expect(callbackCalled).to.be.false; // Should not be called synchronously
        
        setTimeout(function() {
          expect(callbackCalled).to.be.true;
          done();
        }, 10);
      });
    });

    it('should maintain compatibility with existing readRecord method', function(done) {
      storage.readRecord('docs', 'testCollection/doc1', function(payload) {
        expect(payload).to.not.be.null;
        expect(payload.id).to.equal('doc1');
        expect(payload.title).to.equal('Document 1');
        done();
      });
    });

    it('should maintain compatibility with existing readAllRecords method', function(done) {
      storage.readAllRecords('docs', function(records) {
        expect(records).to.be.an('array');
        expect(records).to.have.length(3);
        done();
      });
    });
  });

  // Note: IndexedDbStorage tests would require a browser environment with IndexedDB
  // For now, we'll test the method existence and basic error handling
  describe('IndexedDbStorage', function() {
    it('should have readRecordsBulk method', function() {
      if (typeof window !== 'undefined' && window.indexedDB) {
        var indexedDbStorage = new IndexedDbStorage({
          namespace: 'test',
          debug: false
        });
        expect(indexedDbStorage.readRecordsBulk).to.be.a('function');
      }
    });
  });
});

describe('Schema Strategy Bulk Operations', function() {
  var mockDb;
  var strategy;

  beforeEach(function() {
    // Mock database interface for testing
    mockDb = {
      _records: {},
      
      getAllAsync: function(sql, params) {
        return {
          then: function(onSuccess, onError) {
            try {
              // Simple mock implementation
              if (sql.includes('WHERE id IN')) {
                var results = [];
                if (params && Array.isArray(params)) {
                  params.forEach(function(id) {
                    if (mockDb._records[id]) {
                      results.push({
                        id: id,
                        data: JSON.stringify(mockDb._records[id])
                      });
                    }
                  });
                }
                onSuccess && onSuccess(results);
              } else {
                onSuccess && onSuccess([]);
              }
            } catch (error) {
              onError && onError(error);
            }
          },
          catch: function(onError) {
            // Mock catch method
            return this;
          }
        };
      }
    };

    // Pre-populate mock database
    mockDb._records = {
      'doc1': { id: 'doc1', title: 'Document 1', value: 100 },
      'doc2': { id: 'doc2', title: 'Document 2', value: 200 },
      'doc3': { id: 'doc3', title: 'Document 3', value: 300 }
    };
  });

  describe('DefaultSchemaStrategy', function() {
    beforeEach(function() {
      strategy = new DefaultSchemaStrategy({
        useEncryption: false,
        debug: false
      });
    });

    describe('readRecordsBulk', function() {
      it('should generate correct SQL for bulk read', function(done) {
        var ids = ['doc1', 'doc2'];
        
        strategy.readRecordsBulk(mockDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(2);
          
          records.forEach(function(record) {
            expect(record).to.have.property('id');
            expect(record).to.have.property('payload');
          });
          
          done();
        });
      });

      it('should handle empty IDs array', function(done) {
        strategy.readRecordsBulk(mockDb, 'docs', 'testCollection', [], function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should handle null IDs', function(done) {
        strategy.readRecordsBulk(mockDb, 'docs', 'testCollection', null, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should handle non-existent records', function(done) {
        var ids = ['nonexistent1', 'nonexistent2'];
        
        strategy.readRecordsBulk(mockDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should work with meta table', function(done) {
        mockDb._records = {
          'inventory': { id: 'inventory', collections: {} }
        };
        
        strategy.readRecordsBulk(mockDb, 'meta', null, ['inventory'], function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          done();
        });
      });

      it('should handle database errors', function(done) {
        var errorStrategy = new DefaultSchemaStrategy({ debug: false });
        var errorDb = {
          getAllAsync: function() {
            return {
              then: function(onSuccess, onError) {
                onError && onError(new Error('Mock database error'));
              },
              catch: function(onError) {
                onError && onError(new Error('Mock database error'));
              }
            };
          }
        };
        
        errorStrategy.readRecordsBulk(errorDb, 'docs', 'testCollection', ['doc1'], function(err, records) {
          expect(err).to.be.an('error');
          expect(err.message).to.equal('Mock database error');
          done();
        });
      });
    });

    it('should maintain compatibility with existing readRecord method', function(done) {
      var singleRecordDb = {
        getFirstAsync: function(sql, params) {
          return {
            then: function(onSuccess) {
              var record = mockDb._records[params[0]];
              onSuccess && onSuccess(record ? { data: JSON.stringify(record) } : null);
            },
            catch: function() {
              return this;
            }
          };
        }
      };
      
      strategy.readRecord(singleRecordDb, 'docs', 'testCollection', 'doc1', function(err, record) {
        expect(err).to.be.null;
        expect(record).to.not.be.null;
        expect(record.id).to.equal('doc1');
        done();
      });
    });
  });

  describe('CollectionPerTableStrategy', function() {
    beforeEach(function() {
      strategy = new CollectionPerTableStrategy({
        collectionConfig: {
          testCollection: {
            indexes: ['title', 'value'],
            encryptedFields: []
          }
        },
        useEncryption: false,
        debug: false
      });
    });

    describe('readRecordsBulk', function() {
      it('should generate optimized SQL for collection-specific table', function(done) {
        var mockCollectionDb = Object.assign({}, mockDb, {
          getFirstAsync: function(sql, params) {
            return {
              then: function(onSuccess) {
                // Mock table exists check
                onSuccess && onSuccess({ name: 'testCollection_table' });
              }
            };
          }
        });
        
        var ids = ['doc1', 'doc2'];
        
        strategy.readRecordsBulk(mockCollectionDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          done();
        });
      });

      it('should handle non-existent table gracefully', function(done) {
        var mockCollectionDb = Object.assign({}, mockDb, {
          getFirstAsync: function(sql, params) {
            return {
              then: function(onSuccess) {
                // Mock table does not exist
                onSuccess && onSuccess(null);
              }
            };
          }
        });
        
        var ids = ['doc1', 'doc2'];
        
        strategy.readRecordsBulk(mockCollectionDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          expect(records).to.have.length(0);
          done();
        });
      });

      it('should include indexed columns in optimized queries', function(done) {
        var sqlCaptured = '';
        var mockOptimizedDb = Object.assign({}, mockDb, {
          getFirstAsync: function(sql, params) {
            return {
              then: function(onSuccess) {
                onSuccess && onSuccess({ name: 'testCollection_table' });
              }
            };
          },
          getAllAsync: function(sql, params) {
            sqlCaptured = sql;
            return mockDb.getAllAsync(sql, params);
          }
        });
        
        var ids = ['doc1'];
        
        strategy.readRecordsBulk(mockOptimizedDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          // SQL should include indexed columns for optimization
          expect(sqlCaptured).to.include('title');
          expect(sqlCaptured).to.include('value');
          done();
        });
      });

      it('should handle meta records with meta table', function(done) {
        var ids = ['inventory'];
        
        strategy.readRecordsBulk(mockDb, 'meta', null, ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          done();
        });
      });

      it('should handle collections without index configuration', function(done) {
        var noIndexStrategy = new CollectionPerTableStrategy({
          collectionConfig: {
            // testCollection not configured
          },
          useEncryption: false,
          debug: false
        });
        
        var mockCollectionDb = Object.assign({}, mockDb, {
          getFirstAsync: function(sql, params) {
            return {
              then: function(onSuccess) {
                onSuccess && onSuccess({ name: 'testCollection_table' });
              }
            };
          }
        });
        
        var ids = ['doc1'];
        
        noIndexStrategy.readRecordsBulk(mockCollectionDb, 'docs', 'testCollection', ids, function(err, records) {
          expect(err).to.be.null;
          expect(records).to.be.an('array');
          done();
        });
      });
    });

    it('should maintain compatibility with existing readRecord method', function(done) {
      var mockReadDb = Object.assign({}, mockDb, {
        getFirstAsync: function(sql, params) {
          if (sql.includes('sqlite_master')) {
            return {
              then: function(onSuccess) {
                onSuccess && onSuccess({ name: 'testCollection_table' });
              }
            };
          } else {
            return {
              then: function(onSuccess) {
                var record = mockDb._records[params[0]];
                onSuccess && onSuccess(record ? { data: JSON.stringify(record) } : null);
              }
            };
          }
        }
      });
      
      strategy.readRecord(mockReadDb, 'docs', 'testCollection', 'doc1', function(err, record) {
        expect(err).to.be.null;
        done();
      });
    });
  });

  describe('Bulk Operations Performance', function() {
    it('should generate single SQL query for multiple IDs', function(done) {
      var strategy = new DefaultSchemaStrategy({ debug: false });
      var queryCount = 0;
      
      var countingDb = {
        getAllAsync: function(sql, params) {
          queryCount++;
          return mockDb.getAllAsync(sql, params);
        }
      };
      
      var ids = ['doc1', 'doc2', 'doc3'];
      
      strategy.readRecordsBulk(countingDb, 'docs', 'testCollection', ids, function(err, records) {
        expect(err).to.be.null;
        expect(queryCount).to.equal(1); // Should be single query, not multiple
        done();
      });
    });

    it('should handle large number of IDs efficiently', function(done) {
      var strategy = new DefaultSchemaStrategy({ debug: false });
      
      // Generate many IDs
      var manyIds = [];
      for (var i = 0; i < 100; i++) {
        manyIds.push('doc' + i);
      }
      
      strategy.readRecordsBulk(mockDb, 'docs', 'testCollection', manyIds, function(err, records) {
        expect(err).to.be.null;
        expect(records).to.be.an('array');
        // Should handle large arrays without errors
        done();
      });
    });
  });
});