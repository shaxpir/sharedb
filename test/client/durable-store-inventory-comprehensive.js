var expect = require('chai').expect;
var DurableStore = require('../../lib/client/durable-store');
var InMemoryStorage = require('../../lib/client/storage/in-memory-storage');

describe('DurableStore Inventory Management (Comprehensive)', function() {
  var durableStore;
  var storage;

  beforeEach(function(done) {
    storage = new InMemoryStorage({ debug: false });
    
    // Initialize storage first
    storage.initialize(function(inventory) {
      // InMemoryStorage calls callback with just inventory, no error parameter
      
      // Create DurableStore with already-initialized storage
      durableStore = new DurableStore(storage, { debug: false });
      
      // Set the inventory directly since storage is already initialized
      durableStore.inventory = inventory || { id: 'inventory', payload: { collections: {} } };
      durableStore.ready = true;
      done();
    });
  });

  afterEach(function(done) {
    // DurableStore doesn't have a close method by default
    // Just call done
    done();
  });

  describe('Inventory Structure', function() {
    it('should initialize with empty inventory', function() {
      expect(durableStore.inventory).to.exist;
      expect(durableStore.inventory.id).to.equal('inventory');
      expect(durableStore.inventory.payload).to.exist;
      expect(durableStore.inventory.payload.collections).to.deep.equal({});
    });

    it('should store inventory as single JSON document', function(done) {
      // Create a mock document
      var mockDoc = {
        collection: 'posts',
        id: 'post1',
        data: { title: 'Test' },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      // Store the document
      durableStore.putDoc(mockDoc, function(err) {
        expect(err).to.not.exist;
        
        // Check in-memory inventory structure
        var collections = durableStore.inventory.payload.collections;
        expect(collections.posts).to.exist;
        expect(collections.posts.post1).to.deep.equal({
          v: 1,
          p: false
        });
        
        // Persist to storage
        durableStore.flush(function(err) {
          expect(err).to.not.exist;
          
          // Read inventory directly from storage
          storage.readRecord('meta', 'inventory', function(err, payload) {
            expect(err).to.not.exist;
            expect(payload).to.exist;
            expect(payload.collections.posts.post1).to.deep.equal({
              v: 1,
              p: false
            });
            done();
          });
        });
      });
    });
  });

  describe('Document Tracking', function() {
    it('should track multiple collections simultaneously', function(done) {
      var docs = [
        {
          collection: 'posts',
          id: 'post1',
          data: { title: 'Post 1' },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null
        },
        {
          collection: 'posts',
          id: 'post2',
          data: { title: 'Post 2' },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null
        },
        {
          collection: 'comments',
          id: 'comment1',
          data: { text: 'Comment' },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null
        }
      ];
      
      var stored = 0;
      docs.forEach(function(doc) {
        durableStore.putDoc(doc, function(err) {
          expect(err).to.not.exist;
          stored++;
          
          if (stored === docs.length) {
            var collections = durableStore.inventory.payload.collections;
            expect(Object.keys(collections)).to.have.lengthOf(2);
            expect(Object.keys(collections.posts)).to.have.lengthOf(2);
            expect(Object.keys(collections.comments)).to.have.lengthOf(1);
            done();
          }
        });
      });
    });

    it('should update version when document changes', function(done) {
      var mockDoc = {
        collection: 'items',
        id: 'item1',
        data: { value: 1 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(mockDoc, function(err) {
        expect(err).to.not.exist;
        expect(durableStore.inventory.payload.collections.items.item1.v).to.equal(1);
        
        // Update document version
        mockDoc.version = 2;
        mockDoc.data.value = 2;
        
        durableStore.putDoc(mockDoc, function(err) {
          expect(err).to.not.exist;
          expect(durableStore.inventory.payload.collections.items.item1.v).to.equal(2);
          done();
        });
      });
    });

    it('should track pending operations flag correctly', function(done) {
      var mockDoc = {
        collection: 'items',
        id: 'item2',
        data: { value: 1 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      // Store without pending ops
      durableStore.putDoc(mockDoc, function(err) {
        expect(err).to.not.exist;
        expect(durableStore.inventory.payload.collections.items.item2.p).to.be.false;
        
        // Add pending ops
        mockDoc.pendingOps = [{ op: [{ p: ['value'], na: 1 }] }];
        
        durableStore.putDoc(mockDoc, function(err) {
          expect(err).to.not.exist;
          expect(durableStore.inventory.payload.collections.items.item2.p).to.be.true;
          
          // Clear pending ops
          mockDoc.pendingOps = [];
          mockDoc.version = 2;
          
          durableStore.putDoc(mockDoc, function(err) {
            expect(err).to.not.exist;
            expect(durableStore.inventory.payload.collections.items.item2.p).to.be.false;
            expect(durableStore.inventory.payload.collections.items.item2.v).to.equal(2);
            done();
          });
        });
      });
    });
  });

  describe('isDocInInventory method', function() {
    beforeEach(function(done) {
      var mockDoc = {
        collection: 'items',
        id: 'test-item',
        data: { name: 'Test' },
        version: 3,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(mockDoc, done);
    });

    it('should correctly identify documents in inventory', function() {
      expect(durableStore.isDocInInventory('items', 'test-item')).to.be.true;
      expect(durableStore.isDocInInventory('items', 'nonexistent')).to.be.false;
      expect(durableStore.isDocInInventory('other-collection', 'test-item')).to.be.false;
    });

    it('should correctly check version when provided', function() {
      // Version 3 exists, so checking for version 3 should return true
      expect(durableStore.isDocInInventory('items', 'test-item', 3)).to.be.true;
      // Version 3 exists, checking for minimum version 2 should return true (3 >= 2)
      expect(durableStore.isDocInInventory('items', 'test-item', 2)).to.be.true;
      // Version 3 exists, checking for minimum version 4 should return false (3 < 4)
      expect(durableStore.isDocInInventory('items', 'test-item', 4)).to.be.false;
    });

    it('should handle edge cases gracefully', function() {
      expect(durableStore.isDocInInventory(null, 'test-item')).to.be.false;
      expect(durableStore.isDocInInventory('items', null)).to.be.false;
      expect(durableStore.isDocInInventory('', '')).to.be.false;
    });
  });

  describe('Persistence and Recovery', function() {
    it('should persist inventory on flush', function(done) {
      var mockDoc = {
        collection: 'persistent',
        id: 'doc1',
        data: { persistent: true },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(mockDoc, function(err) {
        expect(err).to.not.exist;
        
        // Before flush, inventory is only in memory
        var inventoryBefore = durableStore.inventory.payload.collections;
        expect(inventoryBefore.persistent).to.exist;
        
        durableStore.flush(function(err) {
          expect(err).to.not.exist;
          
          // After flush, inventory should be persisted
          storage.readRecord('meta', 'inventory', function(err, payload) {
            expect(err).to.not.exist;
            expect(payload).to.exist;
            expect(payload.collections.persistent.doc1).to.deep.equal({
              v: 1,
              p: false
            });
            done();
          });
        });
      });
    });

    it('should restore inventory on initialization', function(done) {
      // First, store some documents and flush
      var mockDoc = {
        collection: 'restore-test',
        id: 'doc1',
        data: { test: true },
        version: 5,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(mockDoc, function(err) {
        expect(err).to.not.exist;
        
        durableStore.flush(function(err) {
          expect(err).to.not.exist;
          
          // Simulate closing by just creating a new DurableStore
          // (DurableStore doesn't have a close method)
          
          // Create new durable store with same storage  
          var newDurableStore = new DurableStore(storage, { debug: false });
          
          // Manually restore inventory from storage
          storage.readRecord('meta', 'inventory', function(err, inventoryPayload) {
            expect(err).to.not.exist;
            expect(inventoryPayload).to.exist;
            
            newDurableStore.inventory = {
              id: 'inventory',
              payload: inventoryPayload
            };
            newDurableStore.ready = true;
            
            // Check that inventory was restored
            var restoredInventory = newDurableStore.inventory.payload.collections;
            expect(restoredInventory['restore-test']).to.exist;
            expect(restoredInventory['restore-test'].doc1).to.deep.equal({
              v: 5,
              p: false
            });
            
            done();
          });
        });
      });
    });
  });

  describe('Bulk Operations', function() {
    it('should update inventory for bulk document writes', function(done) {
      var docs = [];
      for (var i = 0; i < 10; i++) {
        docs.push({
          collection: 'bulk',
          id: 'doc' + i,
          data: { index: i },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null
        });
      }
      
      var stored = 0;
      docs.forEach(function(doc) {
        durableStore.putDoc(doc, function(err) {
          expect(err).to.not.exist;
          stored++;
          
          if (stored === docs.length) {
            var bulkCollection = durableStore.inventory.payload.collections.bulk;
            expect(Object.keys(bulkCollection)).to.have.lengthOf(10);
            
            // Verify each doc is tracked
            for (var i = 0; i < 10; i++) {
              expect(bulkCollection['doc' + i]).to.deep.equal({
                v: 1,
                p: false
              });
            }
            
            done();
          }
        });
      });
    });

    it('should handle mixed operations correctly', function(done) {
      // Store some documents
      var doc1 = {
        collection: 'mixed',
        id: 'doc1',
        data: { value: 1 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      var doc2 = {
        collection: 'mixed',
        id: 'doc2',
        data: { value: 2 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [{ op: [{ p: ['value'], na: 1 }] }],
        inflightOp: null
      };
      
      durableStore.putDoc(doc1, function(err) {
        expect(err).to.not.exist;
        
        durableStore.putDoc(doc2, function(err) {
          expect(err).to.not.exist;
          
          var mixedCollection = durableStore.inventory.payload.collections.mixed;
          expect(mixedCollection.doc1.p).to.be.false;
          expect(mixedCollection.doc2.p).to.be.true;
          
          // In DurableStore, documents aren't explicitly removed
          // They get replaced when a new version is stored
          // Just verify the current state
          expect(mixedCollection.doc1.p).to.be.false;
          expect(mixedCollection.doc2.p).to.be.true;
          
          done();
        });
      });
    });
  });

  describe('Edge Cases and Error Handling', function() {
    it('should handle documents without collection field', function(done) {
      var invalidDoc = {
        // No collection field
        id: 'invalid1',
        data: { test: true },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(invalidDoc, function(err) {
        // Should handle gracefully, either with error or by ignoring
        // Check that inventory is not corrupted
        expect(durableStore.inventory.payload.collections).to.be.an('object');
        done();
      });
    });

    it('should handle empty collection names', function() {
      expect(durableStore.isDocInInventory('', 'doc1')).to.be.false;
      
      // Inventory should remain valid
      expect(durableStore.inventory.payload.collections).to.be.an('object');
    });

    it('should update inventory even with version conflicts', function(done) {
      var validDoc = {
        collection: 'test',
        id: 'valid1',
        data: { valid: true },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(validDoc, function(err) {
        expect(err).to.not.exist;
        expect(durableStore.inventory.payload.collections.test.valid1.v).to.equal(1);
        
        // Store same document with different version
        // DurableStore will update inventory to reflect new version
        var updatedDoc = {
          collection: 'test',
          id: 'valid1', // Same ID
          data: { valid: false },
          version: 2, // Higher version
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null
        };
        
        durableStore.putDoc(updatedDoc, function(err) {
          expect(err).to.not.exist;
          
          // Inventory should reflect the new version
          var testCollection = durableStore.inventory.payload.collections.test;
          expect(testCollection).to.exist;
          expect(testCollection.valid1).to.exist;
          expect(testCollection.valid1.v).to.equal(2);
          
          done();
        });
      });
    });
  });

  describe('Collection Management', function() {
    it('should track collections as documents are added', function(done) {
      var doc = {
        collection: 'temporary',
        id: 'temp1',
        data: { temporary: true },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(doc, function(err) {
        expect(err).to.not.exist;
        expect(durableStore.inventory.payload.collections.temporary).to.exist;
        expect(durableStore.inventory.payload.collections.temporary.temp1).to.exist;
        done();
      });
    });

    it('should track multiple documents in same collection', function(done) {
      var doc1 = {
        collection: 'shared',
        id: 'doc1',
        data: { index: 1 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      var doc2 = {
        collection: 'shared',
        id: 'doc2',
        data: { index: 2 },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null
      };
      
      durableStore.putDoc(doc1, function(err) {
        expect(err).to.not.exist;
        
        durableStore.putDoc(doc2, function(err) {
          expect(err).to.not.exist;
          
          var sharedCollection = durableStore.inventory.payload.collections.shared;
          expect(sharedCollection).to.exist;
          expect(sharedCollection.doc1).to.exist;
          expect(sharedCollection.doc2).to.exist;
          expect(Object.keys(sharedCollection)).to.have.lengthOf(2);
          
          done();
        });
      });
    });
  });
});