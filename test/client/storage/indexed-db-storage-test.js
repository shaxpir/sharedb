var expect = require('chai').expect;

// Setup fake-indexeddb for Node.js testing
// Must be done before requiring IndexedDbStorage
require('fake-indexeddb/auto');
var FDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');

// Create a fake window object with indexedDB
global.window = global.window || {};
global.window.indexedDB = global.indexedDB;
global.window.performance = global.performance || { now: function() { return Date.now(); } };

var IndexedDbStorage = require('../../../lib/client/storage/indexed-db-storage');

describe('IndexedDbStorage', function() {
  var storage;
  var testNamespace = 'test_' + Date.now();
  
  beforeEach(function(done) {
    // Clean up any existing database
    var dbName = 'sharedb_' + testNamespace;
    var deleteReq = indexedDB.deleteDatabase(dbName);
    deleteReq.onsuccess = function() {
      done();
    };
    deleteReq.onerror = function() {
      done(); // Ignore errors, DB might not exist
    };
  });
  
  afterEach(function(done) {
    if (storage && storage.db) {
      storage.db.close();
    }
    // Clean up database
    var dbName = 'sharedb_' + testNamespace;
    var deleteReq = indexedDB.deleteDatabase(dbName);
    deleteReq.onsuccess = function() {
      done();
    };
    deleteReq.onerror = function() {
      done();
    };
  });
  
  describe('Initialization', function() {
    it('should initialize with default options', function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        debug: false
      });
      
      storage.initialize(function(inventory) {
        expect(inventory).to.exist;
        expect(inventory.id).to.equal('inventory');
        expect(inventory.payload).to.exist;
        expect(inventory.payload.collections).to.deep.equal({});
        expect(storage.ready).to.be.true;
        done();
      });
    });
    
    it('should initialize with custom namespace', function(done) {
      var customNamespace = 'custom_' + Date.now();
      storage = new IndexedDbStorage({
        namespace: customNamespace,
        debug: false
      });
      
      storage.initialize(function(inventory) {
        expect(storage.dbName).to.equal('sharedb_' + customNamespace);
        expect(storage.namespace).to.equal(customNamespace);
        done();
      });
    });
    
    it('should throw error if IndexedDB is not available', function() {
      // Temporarily remove indexedDB
      var originalIndexedDB = global.indexedDB;
      var originalWindowIndexedDB = global.window.indexedDB;
      global.indexedDB = null;
      global.window.indexedDB = null;
      
      expect(function() {
        new IndexedDbStorage({ namespace: 'test' });
      }).to.throw('can\'t create a IndexedDbStorage without the IndexedDB APIs');
      
      // Restore indexedDB
      global.indexedDB = originalIndexedDB;
      global.window.indexedDB = originalWindowIndexedDB;
    });
  });
  
  describe('Basic CRUD operations', function() {
    beforeEach(function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        debug: false
      });
      storage.initialize(function() {
        done();
      });
    });
    
    it('should write and read a single document', function(done) {
      var docRecord = {
        id: 'doc1',
        payload: {
          title: 'Test Document',
          content: 'This is test content',
          version: 1
        }
      };
      
      storage.writeRecords({ docs: [docRecord] }, function() {
        storage.readRecord('docs', 'doc1', function(payload) {
          expect(payload).to.deep.equal(docRecord.payload);
          done();
        });
      });
    });
    
    it('should write and read multiple documents', function(done) {
      var docs = [
        { id: 'doc1', payload: { title: 'Doc 1', version: 1 } },
        { id: 'doc2', payload: { title: 'Doc 2', version: 1 } },
        { id: 'doc3', payload: { title: 'Doc 3', version: 1 } }
      ];
      
      storage.writeRecords({ docs: docs }, function() {
        storage.readAllRecords('docs', function(records) {
          expect(records).to.have.lengthOf(3);
          expect(records.map(function(r) { return r.id; }).sort()).to.deep.equal(['doc1', 'doc2', 'doc3']);
          done();
        });
      });
    });
    
    it('should update an existing document', function(done) {
      var original = { id: 'doc1', payload: { title: 'Original', version: 1 } };
      var updated = { id: 'doc1', payload: { title: 'Updated', version: 2 } };
      
      storage.writeRecords({ docs: [original] }, function() {
        storage.writeRecords({ docs: [updated] }, function() {
          storage.readRecord('docs', 'doc1', function(payload) {
            expect(payload.title).to.equal('Updated');
            expect(payload.version).to.equal(2);
            done();
          });
        });
      });
    });
    
    it('should delete a document', function(done) {
      var doc = { id: 'doc1', payload: { title: 'To Delete' } };
      
      storage.writeRecords({ docs: [doc] }, function() {
        storage.deleteRecord('docs', 'doc1', function() {
          storage.readRecord('docs', 'doc1', function(payload) {
            expect(payload).to.be.null;
            done();
          });
        });
      });
    });
    
    it('should handle meta records separately from docs', function(done) {
      var metaRecord = {
        id: 'settings',
        payload: { theme: 'dark', language: 'en' }
      };
      
      var docRecord = {
        id: 'doc1',
        payload: { title: 'Document' }
      };
      
      storage.writeRecords({
        meta: metaRecord,
        docs: [docRecord]
      }, function() {
        storage.readRecord('meta', 'settings', function(metaPayload) {
          expect(metaPayload).to.deep.equal(metaRecord.payload);
          
          storage.readRecord('docs', 'doc1', function(docPayload) {
            expect(docPayload).to.deep.equal(docRecord.payload);
            done();
          });
        });
      });
    });
  });
  
  describe('Inventory management', function() {
    beforeEach(function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        debug: false
      });
      storage.initialize(function() {
        done();
      });
    });
    
    it('should maintain inventory of documents', function(done) {
      // The inventory is managed at a higher level (DurableStore)
      // IndexedDbStorage just stores it as a meta record
      var inventory = {
        id: 'inventory',
        payload: {
          collections: {
            'posts': {
              'post1': 1,
              'post2': 2
            }
          }
        }
      };
      
      storage.writeRecords({ meta: inventory }, function() {
        storage.readRecord('meta', 'inventory', function(payload) {
          expect(payload.collections.posts).to.exist;
          expect(payload.collections.posts.post1).to.equal(1);
          expect(payload.collections.posts.post2).to.equal(2);
          done();
        });
      });
    });
  });
  
  describe('Encryption support', function() {
    it('should encrypt and decrypt records when configured', function(done) {
      // Simple XOR encryption for testing
      var encryptionKey = 'test-key';
      var xorCrypt = function(text, key) {
        var result = '';
        for (var i = 0; i < text.length; i++) {
          result += String.fromCharCode(
            text.charCodeAt(i) ^ key.charCodeAt(i % key.length)
          );
        }
        return result;
      };
      
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        useEncryption: true,
        encryptionCallback: function(text) {
          return Buffer.from(xorCrypt(text, encryptionKey)).toString('base64');
        },
        decryptionCallback: function(encrypted) {
          var text = Buffer.from(encrypted, 'base64').toString();
          return xorCrypt(text, encryptionKey);
        },
        debug: false
      });
      
      storage.initialize(function() {
        var secretDoc = {
          id: 'secret1',
          payload: {
            title: 'Secret Document',
            content: 'Confidential information'
          }
        };
        
        storage.writeRecords({ docs: [secretDoc] }, function() {
          // Read it back - should be decrypted automatically
          storage.readRecord('docs', 'secret1', function(payload) {
            expect(payload).to.deep.equal(secretDoc.payload);
            
            // Verify it's actually encrypted in storage
            var transaction = storage.db.transaction(['docs'], 'readonly');
            var objectStore = transaction.objectStore('docs');
            var request = objectStore.get('secret1');
            
            request.onsuccess = function(event) {
              var stored = event.target.result;
              expect(stored.encrypted_payload).to.exist;
              expect(stored.payload).to.not.exist;
              // The encrypted payload should not equal the original
              expect(stored.encrypted_payload).to.not.equal(JSON.stringify(secretDoc.payload));
              done();
            };
          });
        });
      });
    });
    
    it('should not encrypt when useEncryption is false', function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        useEncryption: false,
        debug: false
      });
      
      storage.initialize(function() {
        var doc = {
          id: 'doc1',
          payload: { title: 'Not encrypted' }
        };
        
        storage.writeRecords({ docs: [doc] }, function() {
          // Check raw storage
          var transaction = storage.db.transaction(['docs'], 'readonly');
          var objectStore = transaction.objectStore('docs');
          var request = objectStore.get('doc1');
          
          request.onsuccess = function(event) {
            var stored = event.target.result;
            expect(stored.payload).to.exist;
            expect(stored.encrypted_payload).to.not.exist;
            expect(stored.payload).to.deep.equal(doc.payload);
            done();
          };
        });
      });
    });
  });
  
  describe('Error handling', function() {
    beforeEach(function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        debug: false
      });
      storage.initialize(function() {
        done();
      });
    });
    
    it('should throw error when not ready', function() {
      var notReadyStorage = new IndexedDbStorage({
        namespace: 'not_ready',
        debug: false
      });
      
      expect(function() {
        notReadyStorage.ensureReady();
      }).to.throw('IndexedDbStorage has not been initialized');
    });
    
    it('should handle reading non-existent records', function(done) {
      storage.readRecord('docs', 'non-existent', function(payload) {
        expect(payload).to.be.null;
        done();
      });
    });
    
    it('should handle deleting non-existent records', function(done) {
      // Should not throw error
      storage.deleteRecord('docs', 'non-existent', function() {
        done();
      });
    });
  });
  
  describe('Batch operations', function() {
    beforeEach(function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        maxBatchSize: 3, // Small batch size to test batching with 10 docs
        debug: false
      });
      storage.initialize(function() {
        done();
      });
    });
    
    it('should handle large batches', function(done) {
      var docs = [];
      for (var i = 0; i < 10; i++) {
        docs.push({
          id: 'doc' + i,
          payload: { 
            title: 'Document ' + i,
            content: 'Content for document ' + i
          }
        });
      }
      
      storage.writeRecords({ docs: docs }, function() {
        storage.readAllRecords('docs', function(records) {
          expect(records).to.have.lengthOf(10);
          done();
        });
      });
    });
  });
  
  describe('Clear operations', function() {
    beforeEach(function(done) {
      storage = new IndexedDbStorage({
        namespace: testNamespace,
        debug: false
      });
      storage.initialize(function() {
        done();
      });
    });
    
    it('should clear a specific store', function(done) {
      var docs = [
        { id: 'doc1', payload: { title: 'Doc 1' } },
        { id: 'doc2', payload: { title: 'Doc 2' } }
      ];
      
      storage.writeRecords({ docs: docs }, function() {
        storage.clearStore('docs', function() {
          storage.readAllRecords('docs', function(records) {
            expect(records).to.have.lengthOf(0);
            
            // Meta should still exist
            storage.readRecord('meta', 'inventory', function(inventory) {
              expect(inventory).to.exist;
              done();
            });
          });
        });
      });
    });
    
    it('should clear all stores', function(done) {
      var docs = [{ id: 'doc1', payload: { title: 'Doc' } }];
      var meta = { id: 'settings', payload: { theme: 'dark' } };
      
      storage.writeRecords({ docs: docs, meta: meta }, function() {
        storage.clearAll(function() {
          storage.readAllRecords('docs', function(docRecords) {
            expect(docRecords).to.have.lengthOf(0);
            
            storage.readRecord('meta', 'settings', function(settings) {
              expect(settings).to.be.null;
              
              // Inventory should be restored
              storage.readRecord('meta', 'inventory', function(inventory) {
                expect(inventory).to.exist;
                expect(inventory.collections).to.deep.equal({});
                done();
              });
            });
          });
        });
      });
    });
  });
});