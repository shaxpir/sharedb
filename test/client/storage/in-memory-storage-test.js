var expect = require('chai').expect;
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');

describe('InMemoryStorage', function() {
  var storage;
  
  beforeEach(function() {
    storage = new InMemoryStorage({ debug: false });
  });
  
  describe('Initialization', function() {
    it('should initialize immediately', function(done) {
      storage.initialize(function(inventory) {
        expect(inventory).to.exist;
        expect(inventory.id).to.equal('inventory');
        expect(inventory.payload).to.exist;
        expect(inventory.payload.collections).to.deep.equal({});
        expect(storage.ready).to.be.true;
        done();
      });
    });
    
    it('should call callback asynchronously', function(done) {
      var callbackCalled = false;
      
      storage.initialize(function() {
        callbackCalled = true;
        done();
      });
      
      // Callback should not be called synchronously
      expect(callbackCalled).to.be.false;
    });
  });
  
  describe('Basic CRUD operations', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should write and read a single document', function(done) {
      var doc = {
        id: 'doc1',
        payload: {
          title: 'Test Document',
          content: 'Test content',
          version: 1
        }
      };
      
      storage.writeRecords({ docs: [doc] }, function() {
        storage.readRecord('docs', 'doc1', function(payload) {
          expect(payload).to.deep.equal(doc.payload);
          done();
        });
      });
    });
    
    it('should write and read multiple documents', function(done) {
      var docs = [
        { id: 'doc1', payload: { title: 'Doc 1' } },
        { id: 'doc2', payload: { title: 'Doc 2' } },
        { id: 'doc3', payload: { title: 'Doc 3' } }
      ];
      
      storage.writeRecords({ docs: docs }, function() {
        storage.readAllRecords('docs', function(records) {
          expect(records).to.have.lengthOf(3);
          var ids = records.map(function(r) { return r.id; }).sort();
          expect(ids).to.deep.equal(['doc1', 'doc2', 'doc3']);
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
    
    it('should handle non-existent documents', function(done) {
      storage.readRecord('docs', 'non-existent', function(payload) {
        expect(payload).to.be.null;
        done();
      });
    });
    
    it('should handle single record (non-array) writes', function(done) {
      var doc = { id: 'doc1', payload: { title: 'Single Doc' } };
      
      storage.writeRecords({ docs: doc }, function() {
        storage.readRecord('docs', 'doc1', function(payload) {
          expect(payload.title).to.equal('Single Doc');
          done();
        });
      });
    });
  });
  
  describe('Meta storage', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should store meta records separately', function(done) {
      var meta = {
        id: 'settings',
        payload: { theme: 'dark', language: 'en' }
      };
      
      storage.writeRecords({ meta: meta }, function() {
        storage.readRecord('meta', 'settings', function(payload) {
          expect(payload).to.deep.equal(meta.payload);
          done();
        });
      });
    });
    
    it('should handle both docs and meta in one write', function(done) {
      var doc = { id: 'doc1', payload: { title: 'Document' } };
      var meta = { id: 'config', payload: { version: '1.0' } };
      
      storage.writeRecords({ docs: [doc], meta: meta }, function() {
        storage.readRecord('docs', 'doc1', function(docPayload) {
          expect(docPayload).to.deep.equal(doc.payload);
          
          storage.readRecord('meta', 'config', function(metaPayload) {
            expect(metaPayload).to.deep.equal(meta.payload);
            done();
          });
        });
      });
    });
    
    it('should preserve inventory after writes', function(done) {
      var doc = { id: 'doc1', payload: { title: 'Doc' } };
      
      storage.writeRecords({ docs: [doc] }, function() {
        storage.readRecord('meta', 'inventory', function(inventory) {
          expect(inventory).to.exist;
          expect(inventory.collections).to.exist;
          done();
        });
      });
    });
  });
  
  describe('Clear operations', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should clear a specific store', function(done) {
      var docs = [
        { id: 'doc1', payload: { title: 'Doc 1' } },
        { id: 'doc2', payload: { title: 'Doc 2' } }
      ];
      var meta = { id: 'settings', payload: { theme: 'dark' } };
      
      storage.writeRecords({ docs: docs, meta: meta }, function() {
        storage.clearStore('docs', function() {
          storage.readAllRecords('docs', function(records) {
            expect(records).to.have.lengthOf(0);
            
            // Meta should still exist
            storage.readRecord('meta', 'settings', function(payload) {
              expect(payload).to.exist;
              expect(payload.theme).to.equal('dark');
              done();
            });
          });
        });
      });
    });
    
    it('should clear all data', function(done) {
      var docs = [
        { id: 'doc1', payload: { title: 'Doc 1' } },
        { id: 'doc2', payload: { title: 'Doc 2' } }
      ];
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
    
    it('should handle clearing empty store', function(done) {
      storage.clearStore('docs', function() {
        storage.readAllRecords('docs', function(records) {
          expect(records).to.have.lengthOf(0);
          done();
        });
      });
    });
  });
  
  describe('Error handling', function() {
    it('should throw error when not initialized', function() {
      var uninitializedStorage = new InMemoryStorage();
      
      expect(function() {
        uninitializedStorage.ensureReady();
      }).to.throw('InMemoryStorage has not been initialized');
    });
    
    it('should handle operations on non-existent stores gracefully', function(done) {
      storage.initialize(function() {
        storage.readAllRecords('non-existent', function(records) {
          expect(records).to.be.an('array');
          expect(records).to.have.lengthOf(0);
          done();
        });
      });
    });
    
    it('should handle deleting non-existent records', function(done) {
      storage.initialize(function() {
        storage.deleteRecord('docs', 'non-existent', function() {
          // Should not throw error
          done();
        });
      });
    });
  });
  
  describe('Memory characteristics', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should not persist data across instances', function(done) {
      var doc = { id: 'doc1', payload: { title: 'Test' } };
      
      storage.writeRecords({ docs: [doc] }, function() {
        // Create a new storage instance
        var newStorage = new InMemoryStorage({ debug: false });
        newStorage.initialize(function() {
          newStorage.readRecord('docs', 'doc1', function(payload) {
            expect(payload).to.be.null; // Should not exist in new instance
            done();
          });
        });
      });
    });
    
    it('should maintain separate data for different instances', function(done) {
      var storage1 = new InMemoryStorage({ debug: false });
      var storage2 = new InMemoryStorage({ debug: false });
      
      storage1.initialize(function() {
        storage2.initialize(function() {
          var doc1 = { id: 'doc1', payload: { title: 'Storage 1' } };
          var doc2 = { id: 'doc1', payload: { title: 'Storage 2' } };
          
          storage1.writeRecords({ docs: [doc1] }, function() {
            storage2.writeRecords({ docs: [doc2] }, function() {
              storage1.readRecord('docs', 'doc1', function(payload1) {
                expect(payload1.title).to.equal('Storage 1');
                
                storage2.readRecord('docs', 'doc1', function(payload2) {
                  expect(payload2.title).to.equal('Storage 2');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });
  
  describe('Performance characteristics', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should handle large numbers of documents efficiently', function(done) {
      var docs = [];
      var numDocs = 1000;
      
      for (var i = 0; i < numDocs; i++) {
        docs.push({
          id: 'doc' + i,
          payload: {
            title: 'Document ' + i,
            content: 'Content for document ' + i,
            index: i
          }
        });
      }
      
      var startWrite = Date.now();
      storage.writeRecords({ docs: docs }, function() {
        var writeTime = Date.now() - startWrite;
        expect(writeTime).to.be.below(100); // Should be very fast in memory
        
        var startRead = Date.now();
        storage.readAllRecords('docs', function(records) {
          var readTime = Date.now() - startRead;
          expect(readTime).to.be.below(50); // Reading should be even faster
          expect(records).to.have.lengthOf(numDocs);
          done();
        });
      });
    });
  });
  
  describe('hasOwnProperty handling', function() {
    beforeEach(function(done) {
      storage.initialize(function() {
        done();
      });
    });
    
    it('should correctly handle hasOwnProperty checks', function(done) {
      // This tests for a common JavaScript pitfall
      var doc = { 
        id: 'constructor', // Special property name
        payload: { title: 'Test' } 
      };
      
      storage.writeRecords({ docs: [doc] }, function() {
        storage.readRecord('docs', 'constructor', function(payload) {
          expect(payload).to.deep.equal(doc.payload);
          done();
        });
      });
    });
  });
});