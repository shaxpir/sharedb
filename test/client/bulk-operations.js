var expect = require('chai').expect;
var Backend = require('../../lib/backend');
var Connection = require('../../lib/client/connection');
var DurableStore = require('../../lib/client/durable-store');
var InMemoryStorage = require('../../lib/client/storage/in-memory-storage');

describe('Connection Bulk Operations', function() {
  var backend;
  var connection;
  var durableStore;
  var storage;

  beforeEach(function(done) {
    backend = new Backend();
    connection = backend.connect();
    
    // Set up DurableStore for testing
    storage = new InMemoryStorage({ debug: false });
    durableStore = new DurableStore(storage, { 
      maxBatchSize: 10,
      debug: false
    });
    
    storage.initialize(function() {
      durableStore.initialize(function() {
        connection.durableStore = durableStore;
        done();
      });
    });
  });

  afterEach(function() {
    if (connection) {
      connection.close();
    }
    if (backend) {
      backend.close();
    }
  });

  describe('getBulk', function() {
    it('should return empty array for empty ids array', function(done) {
      connection.getBulk('testCollection', [], function(err, docs) {
        expect(err).to.be.null;
        expect(docs).to.be.an('array');
        expect(docs).to.have.length(0);
        done();
      });
    });

    it('should return error for non-array ids', function(done) {
      connection.getBulk('testCollection', 'not-an-array', function(err, docs) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('ids must be an array');
        done();
      });
    });

    it('should return documents in original order', function(done) {
      var ids = ['doc3', 'doc1', 'doc2'];
      
      connection.getBulk('testCollection', ids, function(err, docs) {
        expect(err).to.be.null;
        expect(docs).to.have.length(3);
        expect(docs[0].id).to.equal('doc3');
        expect(docs[1].id).to.equal('doc1');
        expect(docs[2].id).to.equal('doc2');
        expect(docs[0].collection).to.equal('testCollection');
        done();
      });
    });

    it('should create documents in connection cache', function(done) {
      var ids = ['cache1', 'cache2'];
      
      connection.getBulk('testCollection', ids, function(err, docs) {
        expect(err).to.be.null;
        
        // Check that documents are in connection cache
        expect(connection.collections.testCollection).to.exist;
        expect(connection.collections.testCollection.cache1).to.exist;
        expect(connection.collections.testCollection.cache2).to.exist;
        expect(connection.collections.testCollection.cache1).to.equal(docs[0]);
        expect(connection.collections.testCollection.cache2).to.equal(docs[1]);
        done();
      });
    });

    it('should leverage cache for subsequent calls', function(done) {
      var ids = ['cached1', 'cached2'];
      
      // First call - creates docs in cache
      connection.getBulk('testCollection', ids, function(err, firstDocs) {
        expect(err).to.be.null;
        
        // Second call - should return same doc objects from cache
        connection.getBulk('testCollection', ids, function(err, secondDocs) {
          expect(err).to.be.null;
          expect(firstDocs[0]).to.equal(secondDocs[0]); // Same object reference
          expect(firstDocs[1]).to.equal(secondDocs[1]); // Same object reference
          done();
        });
      });
    });

    it('should handle mixed cached and uncached documents', function(done) {
      var doc1 = connection.get('testCollection', 'mixed1'); // This will be cached
      var ids = ['mixed1', 'mixed2', 'mixed3']; // mixed1 cached, others not
      
      connection.getBulk('testCollection', ids, function(err, docs) {
        expect(err).to.be.null;
        expect(docs).to.have.length(3);
        expect(docs[0]).to.equal(doc1); // Should be the same cached object
        expect(docs[1].id).to.equal('mixed2');
        expect(docs[2].id).to.equal('mixed3');
        done();
      });
    });

    it('should work without DurableStore', function(done) {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      connectionWithoutStore.getBulk('testCollection', ['no-store1', 'no-store2'], function(err, docs) {
        expect(err).to.be.null;
        expect(docs).to.have.length(2);
        expect(docs[0].id).to.equal('no-store1');
        expect(docs[1].id).to.equal('no-store2');
        
        connectionWithoutStore.close();
        done();
      });
    });
  });

  describe('Auto-Flush Control', function() {
    it('should have auto-flush enabled by default', function() {
      expect(connection.isAutoFlush()).to.be.true;
    });

    it('should allow disabling auto-flush', function() {
      connection.setAutoFlush(false);
      expect(connection.isAutoFlush()).to.be.false;
    });

    it('should allow re-enabling auto-flush', function() {
      connection.setAutoFlush(false);
      connection.setAutoFlush(true);
      expect(connection.isAutoFlush()).to.be.true;
    });

    it('should work without DurableStore', function() {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      // Should not throw errors
      connectionWithoutStore.setAutoFlush(false);
      expect(connectionWithoutStore.isAutoFlush()).to.be.true; // Default when no DurableStore
      
      connectionWithoutStore.close();
    });
  });

  describe('putDoc', function() {
    it('should add document to write queue', function(done) {
      // Ensure DurableStore is ready before testing
      expect(durableStore.ready).to.be.true;
      
      var doc = connection.get('testCollection', 'putDoc1');
      doc.create({ title: 'Test Doc' });
      
      connection.putDoc(doc, function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle error when no DurableStore', function(done) {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      var doc = connectionWithoutStore.get('testCollection', 'errorDoc');
      doc.create({ title: 'Error Test' });
      
      connectionWithoutStore.putDoc(doc, function(err) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('No DurableStore available');
        
        connectionWithoutStore.close();
        done();
      });
    });
  });

  describe('putDocs', function() {
    it('should add multiple documents to write queue', function(done) {
      var docs = [];
      for (var i = 0; i < 3; i++) {
        var doc = connection.get('testCollection', 'putDocs' + i);
        doc.create({ title: 'Test Doc ' + i, index: i });
        docs.push(doc);
      }
      
      connection.putDocs(docs, function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle empty array', function(done) {
      connection.putDocs([], function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle non-array input', function(done) {
      connection.putDocs('not-an-array', function(err) {
        expect(err).to.be.null; // Should handle gracefully
        done();
      });
    });

    it('should handle error when no DurableStore', function(done) {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      var doc = connectionWithoutStore.get('testCollection', 'errorDoc');
      doc.create({ title: 'Error Test' });
      
      connectionWithoutStore.putDocs([doc], function(err) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('No DurableStore available');
        
        connectionWithoutStore.close();
        done();
      });
    });

    it('should propagate individual document errors', function(done) {
      // Create a scenario that might cause errors
      var docs = [];
      for (var i = 0; i < 2; i++) {
        var doc = connection.get('testCollection', 'errorTest' + i);
        doc.create({ title: 'Error Test ' + i });
        docs.push(doc);
      }
      
      // Mock an error in the DurableStore
      var originalPutDoc = durableStore.putDoc;
      durableStore.putDoc = function(doc, callback) {
        callback(new Error('Mock storage error'));
      };
      
      connection.putDocs(docs, function(err) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('Mock storage error');
        
        // Restore original method
        durableStore.putDoc = originalPutDoc;
        done();
      });
    });
  });

  describe('putDocsBulk', function() {
    it('should write multiple documents in bulk', function(done) {
      var docs = [];
      for (var i = 0; i < 5; i++) {
        var doc = connection.get('testCollection', 'bulk' + i);
        doc.create({ title: 'Bulk Doc ' + i, index: i });
        docs.push(doc);
      }
      
      connection.putDocsBulk(docs, function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle empty array', function(done) {
      connection.putDocsBulk([], function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle error when no DurableStore', function(done) {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      var doc = connectionWithoutStore.get('testCollection', 'bulkError');
      doc.create({ title: 'Bulk Error Test' });
      
      connectionWithoutStore.putDocsBulk([doc], function(err) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('No DurableStore available');
        
        connectionWithoutStore.close();
        done();
      });
    });
  });

  describe('flushWrites', function() {
    it('should flush pending writes', function(done) {
      // Disable auto-flush
      connection.setAutoFlush(false);
      
      var doc = connection.get('testCollection', 'flushTest');
      doc.create({ title: 'Flush Test' });
      
      connection.putDoc(doc, function() {
        // Document should be queued
        expect(connection.hasPendingWrites()).to.be.true;
        expect(connection.getWriteQueueSize()).to.be.greaterThan(0);
        
        // Flush writes
        connection.flushWrites(function(err) {
          expect(err).to.be.null;
          // Queue should be cleared after flush
          expect(connection.getWriteQueueSize()).to.equal(0);
          
          // Re-enable auto-flush
          connection.setAutoFlush(true);
          done();
        });
      });
    });

    it('should handle no pending writes', function(done) {
      connection.flushWrites(function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should work without DurableStore', function(done) {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      connectionWithoutStore.flushWrites(function(err) {
        expect(err).to.be.null; // Should not error
        
        connectionWithoutStore.close();
        done();
      });
    });
  });

  describe('Queue Inspection', function() {
    it('should return correct write queue size', function() {
      expect(connection.getWriteQueueSize()).to.equal(0);
    });

    it('should return false for hasPendingWrites when empty', function() {
      expect(connection.hasPendingWrites()).to.be.false;
    });

    it('should work without DurableStore', function() {
      var connectionWithoutStore = backend.connect();
      connectionWithoutStore.durableStore = null;
      
      expect(connectionWithoutStore.getWriteQueueSize()).to.equal(0);
      expect(connectionWithoutStore.hasPendingWrites()).to.be.false;
      
      connectionWithoutStore.close();
    });

    it('should track pending writes correctly', function(done) {
      // Disable auto-flush to test queue behavior
      connection.setAutoFlush(false);
      
      var doc = connection.get('testCollection', 'queueTest');
      doc.create({ title: 'Queue Test' });
      
      connection.putDoc(doc, function() {
        expect(connection.hasPendingWrites()).to.be.true;
        expect(connection.getWriteQueueSize()).to.be.greaterThan(0);
        
        // Flush to clear queue
        connection.flushWrites(function() {
          expect(connection.hasPendingWrites()).to.be.false;
          expect(connection.getWriteQueueSize()).to.equal(0);
          
          connection.setAutoFlush(true);
          done();
        });
      });
    });
  });

  describe('Integration Tests', function() {
    it('should handle bulk read and write operations together', function(done) {
      // First create some documents with bulk write
      var writeDocs = [];
      for (var i = 0; i < 3; i++) {
        var doc = connection.get('integration', 'doc' + i);
        doc.create({ title: 'Integration Doc ' + i, value: i * 10 });
        writeDocs.push(doc);
      }
      
      connection.putDocsBulk(writeDocs, function(writeErr) {
        expect(writeErr).to.be.null;
        
        // Then read them back with bulk read
        var readIds = ['doc0', 'doc1', 'doc2'];
        connection.getBulk('integration', readIds, function(readErr, readDocs) {
          expect(readErr).to.be.null;
          expect(readDocs).to.have.length(3);
          
          // Verify documents are the same objects (from cache)
          for (var j = 0; j < 3; j++) {
            expect(readDocs[j]).to.equal(writeDocs[j]);
            expect(readDocs[j].id).to.equal('doc' + j);
          }
          
          done();
        });
      });
    });

    it('should maintain cache consistency across operations', function(done) {
      var doc1 = connection.get('consistency', 'test1');
      doc1.create({ initial: true });
      
      // First bulk read should return cached document
      connection.getBulk('consistency', ['test1'], function(err, docs) {
        expect(err).to.be.null;
        expect(docs[0]).to.equal(doc1); // Same object reference
        
        // Modify and save
        doc1.data.modified = true;
        connection.putDoc(doc1, function(putErr) {
          expect(putErr).to.be.null;
          
          // Second bulk read should still return same cached object
          connection.getBulk('consistency', ['test1'], function(err2, docs2) {
            expect(err2).to.be.null;
            expect(docs2[0]).to.equal(doc1); // Still same object reference
            expect(docs2[0].data.modified).to.be.true; // With modifications
            
            done();
          });
        });
      });
    });

    it('should handle auto-flush control across multiple operations', function(done) {
      connection.setAutoFlush(false);
      
      // Add multiple documents without auto-flush
      var docs = [];
      for (var i = 0; i < 4; i++) {
        var doc = connection.get('autoflush', 'test' + i);
        doc.create({ index: i, title: 'Auto-flush Test ' + i });
        docs.push(doc);
      }
      
      var remaining = docs.length;
      docs.forEach(function(doc) {
        connection.putDoc(doc, function() {
          remaining--;
          if (remaining === 0) {
            // All docs should be queued
            expect(connection.getWriteQueueSize()).to.be.greaterThan(0);
            expect(connection.hasPendingWrites()).to.be.true;
            
            // Flush all at once
            connection.flushWrites(function() {
              expect(connection.getWriteQueueSize()).to.equal(0);
              
              // Re-enable auto-flush
              connection.setAutoFlush(true);
              expect(connection.isAutoFlush()).to.be.true;
              
              done();
            });
          }
        });
      });
    });
  });
});