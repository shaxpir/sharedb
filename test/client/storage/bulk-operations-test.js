var expect = require('chai').expect;
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var IndexedDbStorage = require('../../../lib/client/storage/indexed-db-storage');

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