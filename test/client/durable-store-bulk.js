var expect = require('chai').expect;
var DurableStore = require('../../lib/client/durable-store');
var InMemoryStorage = require('../../lib/client/storage/in-memory-storage');

describe('DurableStore Bulk Operations', function() {
  var durableStore;
  var storage;
  var mockDocs;

  beforeEach(function(done) {
    storage = new InMemoryStorage({ debug: false });
    durableStore = new DurableStore(storage, {
      maxBatchSize: 5,
      debug: false
    });
    
    // Create mock documents for testing
    mockDocs = [];
    for (var i = 0; i < 3; i++) {
      mockDocs.push({
        collection: 'testCollection',
        id: 'doc' + i,
        data: { title: 'Test Doc ' + i, index: i },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null,
        preventCompose: false,
        submitSource: false,
        connection: { id: 'test-connection' }
      });
    }
    
    storage.initialize(function() {
      durableStore.initialize(function() {
        done();
      });
    });
  });

  describe('retrieveDocumentsBulk', function() {
    beforeEach(function(done) {
      // Pre-populate storage with some test documents
      var docRecords = mockDocs.map(function(doc) {
        return durableStore.makeDocRecord(doc);
      });
      
      storage.writeRecords({ docs: docRecords }, function() {
        done();
      });
    });

    it('should retrieve multiple documents by collection and ids', function(done) {
      var ids = ['doc0', 'doc1', 'doc2'];
      
      durableStore.retrieveDocumentsBulk('testCollection', ids, function(err, docDatas) {
        expect(err).to.be.null;
        expect(docDatas).to.be.an('array');
        expect(docDatas).to.have.length(3);
        
        // Check that all expected documents are returned
        var returnedIds = docDatas.map(function(d) { return d.id; });
        expect(returnedIds).to.include.members(['doc0', 'doc1', 'doc2']);
        
        // Check document structure
        docDatas.forEach(function(docData) {
          expect(docData).to.have.property('id');
          expect(docData).to.have.property('data');
          expect(docData).to.have.property('v');
          expect(docData).to.have.property('type');
        });
        
        done();
      });
    });

    it('should return empty array for empty ids array', function(done) {
      durableStore.retrieveDocumentsBulk('testCollection', [], function(err, docDatas) {
        expect(err).to.be.null;
        expect(docDatas).to.be.an('array');
        expect(docDatas).to.have.length(0);
        done();
      });
    });

    it('should return empty array for null ids', function(done) {
      durableStore.retrieveDocumentsBulk('testCollection', null, function(err, docDatas) {
        expect(err).to.be.null;
        expect(docDatas).to.be.an('array');
        expect(docDatas).to.have.length(0);
        done();
      });
    });

    it('should handle non-existent documents gracefully', function(done) {
      var ids = ['nonexistent1', 'nonexistent2'];
      
      durableStore.retrieveDocumentsBulk('testCollection', ids, function(err, docDatas) {
        expect(err).to.be.null;
        expect(docDatas).to.be.an('array');
        expect(docDatas).to.have.length(0); // No documents found
        done();
      });
    });

    it('should handle mixed existent and non-existent documents', function(done) {
      var ids = ['doc0', 'nonexistent', 'doc2'];
      
      durableStore.retrieveDocumentsBulk('testCollection', ids, function(err, docDatas) {
        expect(err).to.be.null;
        expect(docDatas).to.be.an('array');
        expect(docDatas).to.have.length(2); // Only existent documents returned
        
        var returnedIds = docDatas.map(function(d) { return d.id; });
        expect(returnedIds).to.include.members(['doc0', 'doc2']);
        expect(returnedIds).to.not.include('nonexistent');
        
        done();
      });
    });

    it('should use storage bulk method when available', function(done) {
      var bulkMethodCalled = false;
      
      // Mock the storage bulk method
      storage.readRecordsBulk = function(storeName, ids, callback) {
        bulkMethodCalled = true;
        expect(storeName).to.equal('docs');
        expect(ids).to.be.an('array');
        callback(null, []);
      };
      
      durableStore.retrieveDocumentsBulk('testCollection', ['doc0'], function(err, docDatas) {
        expect(err).to.be.null;
        expect(bulkMethodCalled).to.be.true;
        done();
      });
    });

    it('should fall back to individual getDoc calls when bulk method unavailable', function(done) {
      var getDocCallCount = 0;
      
      // Remove bulk method to test fallback
      storage.readRecordsBulk = undefined;
      
      var originalGetDoc = durableStore.getDoc;
      durableStore.getDoc = function(collection, id, callback) {
        getDocCallCount++;
        originalGetDoc.call(this, collection, id, callback);
      };
      
      var ids = ['doc0', 'doc1'];
      durableStore.retrieveDocumentsBulk('testCollection', ids, function(err, docDatas) {
        expect(err).to.be.null;
        expect(getDocCallCount).to.equal(2); // Should call getDoc for each ID
        
        // Restore original method
        durableStore.getDoc = originalGetDoc;
        done();
      });
    });

    it('should handle errors from storage operations', function(done) {
      // Mock storage to return error
      storage.readRecordsBulk = function(storeName, ids, callback) {
        callback(new Error('Mock storage error'));
      };
      
      durableStore.retrieveDocumentsBulk('testCollection', ['doc0'], function(err, docDatas) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('Mock storage error');
        done();
      });
    });
  });

  describe('putDocsBulk', function() {
    it('should write multiple documents in bulk', function(done) {
      durableStore.putDocsBulk(mockDocs, function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle empty array', function(done) {
      durableStore.putDocsBulk([], function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should handle null input', function(done) {
      durableStore.putDocsBulk(null, function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should temporarily disable auto-batching during bulk operation', function(done) {
      var originalAutoBatch = durableStore.isAutoBatchEnabled();
      var autoBatchStatesDuringOperation = [];
      
      // Mock putDoc to track auto-batch state
      var originalPutDoc = durableStore.putDoc;
      durableStore.putDoc = function(doc, callback) {
        autoBatchStatesDuringOperation.push(this.isAutoBatchEnabled());
        originalPutDoc.call(this, doc, callback);
      };
      
      durableStore.putDocsBulk(mockDocs.slice(0, 2), function(err) {
        expect(err).to.be.null;
        
        // Auto-batching should have been disabled during operation
        autoBatchStatesDuringOperation.forEach(function(state) {
          expect(state).to.be.false;
        });
        
        // Auto-batching should be restored after operation
        expect(durableStore.isAutoBatchEnabled()).to.equal(originalAutoBatch);
        
        // Restore original method
        durableStore.putDoc = originalPutDoc;
        done();
      });
    });

    it('should restore original auto-batch setting even on error', function(done) {
      var originalAutoBatch = durableStore.isAutoBatchEnabled();
      
      // Mock putDoc to return error
      var originalPutDoc = durableStore.putDoc;
      durableStore.putDoc = function(doc, callback) {
        callback(new Error('Mock put error'));
      };
      
      durableStore.putDocsBulk(mockDocs.slice(0, 1), function(err) {
        expect(err).to.be.an('error');
        expect(err.message).to.equal('Mock put error');
        
        // Auto-batching should be restored even after error
        expect(durableStore.isAutoBatchEnabled()).to.equal(originalAutoBatch);
        
        // Restore original method
        durableStore.putDoc = originalPutDoc;
        done();
      });
    });

    it('should call flush after all documents are queued', function(done) {
      var flushCalled = false;
      
      // Mock flush method
      var originalFlush = durableStore.flush;
      durableStore.flush = function(callback) {
        flushCalled = true;
        originalFlush.call(this, callback);
      };
      
      durableStore.putDocsBulk(mockDocs.slice(0, 2), function(err) {
        expect(err).to.be.null;
        expect(flushCalled).to.be.true;
        
        // Restore original method
        durableStore.flush = originalFlush;
        done();
      });
    });
  });

  describe('flush', function() {
    it('should flush pending writes', function(done) {
      // Disable auto-batching and add a document
      durableStore.setAutoBatchEnabled(false);
      
      durableStore.putDoc(mockDocs[0], function() {
        expect(durableStore.hasDocsInWriteQueue()).to.be.true;
        
        durableStore.flush(function(err) {
          expect(err).to.be.null;
          expect(durableStore.hasDocsInWriteQueue()).to.be.false;
          
          durableStore.setAutoBatchEnabled(true);
          done();
        });
      });
    });

    it('should handle empty queue', function(done) {
      durableStore.flush(function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should use existing flush mechanism', function(done) {
      var batchProcessed = false;
      
      // Listen for persist event to confirm flush worked
      durableStore.on('persist', function() {
        batchProcessed = true;
      });
      
      durableStore.setAutoBatchEnabled(false);
      durableStore.putDoc(mockDocs[0], function() {
        durableStore.flush(function(err) {
          expect(err).to.be.null;
          expect(batchProcessed).to.be.true;
          
          durableStore.setAutoBatchEnabled(true);
          done();
        });
      });
    });
  });

  describe('Auto-Batch Control', function() {
    it('should have auto-batching enabled by default', function() {
      expect(durableStore.isAutoBatchEnabled()).to.be.true;
    });

    it('should allow disabling auto-batching', function() {
      durableStore.setAutoBatchEnabled(false);
      expect(durableStore.isAutoBatchEnabled()).to.be.false;
    });

    it('should allow re-enabling auto-batching', function() {
      durableStore.setAutoBatchEnabled(false);
      durableStore.setAutoBatchEnabled(true);
      expect(durableStore.isAutoBatchEnabled()).to.be.true;
    });

    it('should process queued items when re-enabling auto-batching', function(done) {
      durableStore.setAutoBatchEnabled(false);
      
      durableStore.putDoc(mockDocs[0], function() {
        expect(durableStore.hasDocsInWriteQueue()).to.be.true;
        
        // Re-enable auto-batching should trigger processing
        durableStore.setAutoBatchEnabled(true);
        
        // Give it a moment to process
        setTimeout(function() {
          expect(durableStore.hasDocsInWriteQueue()).to.be.false;
          done();
        }, 10);
      });
    });

    it('should not auto-process when auto-batching is disabled', function(done) {
      durableStore.setAutoBatchEnabled(false);
      
      durableStore.putDoc(mockDocs[0], function() {
        expect(durableStore.hasDocsInWriteQueue()).to.be.true;
        
        // Wait and verify queue is not automatically processed
        setTimeout(function() {
          expect(durableStore.hasDocsInWriteQueue()).to.be.true;
          
          durableStore.setAutoBatchEnabled(true);
          done();
        }, 20);
      });
    });
  });

  describe('Queue Inspection', function() {
    it('should return correct queue size', function() {
      expect(durableStore.getWriteQueueSize()).to.equal(0);
    });

    it('should return false for hasDocsInWriteQueue when empty', function() {
      expect(durableStore.hasDocsInWriteQueue()).to.be.false;
    });

    it('should track queue size correctly', function(done) {
      durableStore.setAutoBatchEnabled(false);
      
      expect(durableStore.getWriteQueueSize()).to.equal(0);
      
      durableStore.putDoc(mockDocs[0], function() {
        expect(durableStore.getWriteQueueSize()).to.equal(1);
        expect(durableStore.hasDocsInWriteQueue()).to.be.true;
        
        durableStore.putDoc(mockDocs[1], function() {
          expect(durableStore.getWriteQueueSize()).to.equal(2);
          
          durableStore.flush(function() {
            expect(durableStore.getWriteQueueSize()).to.equal(0);
            expect(durableStore.hasDocsInWriteQueue()).to.be.false;
            
            durableStore.setAutoBatchEnabled(true);
            done();
          });
        });
      });
    });
  });

  describe('Integration with Existing Functionality', function() {
    it('should maintain compatibility with existing putDoc behavior', function(done) {
      durableStore.putDoc(mockDocs[0], function(err) {
        expect(err).to.be.null;
        done();
      });
    });

    it('should maintain compatibility with existing inventory management', function(done) {
      durableStore.putDoc(mockDocs[0], function(err) {
        expect(err).to.be.null;
        
        // Check that inventory is updated
        var inventory = durableStore.inventory;
        expect(inventory.payload.collections).to.have.property('testCollection');
        expect(inventory.payload.collections.testCollection).to.have.property('doc0');
        
        done();
      });
    });

    it('should emit existing events during bulk operations', function(done) {
      var beforePersistEmitted = false;
      var persistEmitted = false;
      
      durableStore.on('before persist', function() {
        beforePersistEmitted = true;
      });
      
      durableStore.on('persist', function() {
        persistEmitted = true;
      });
      
      durableStore.putDocsBulk([mockDocs[0]], function(err) {
        expect(err).to.be.null;
        expect(beforePersistEmitted).to.be.true;
        expect(persistEmitted).to.be.true;
        done();
      });
    });

    it('should work with existing maxBatchSize setting', function(done) {
      // Create more documents than maxBatchSize (5)
      var manyDocs = [];
      for (var i = 0; i < 7; i++) {
        manyDocs.push({
          collection: 'testCollection',
          id: 'many' + i,
          data: { title: 'Many Doc ' + i },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null,
          preventCompose: false,
          submitSource: false,
          connection: { id: 'test-connection' }
        });
      }
      
      durableStore.putDocsBulk(manyDocs, function(err) {
        expect(err).to.be.null;
        // Should handle documents exceeding batch size
        done();
      });
    });
  });
});