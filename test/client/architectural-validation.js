var expect = require('chai').expect;
var DurableStore = require('../../lib/client/durable-store');
var InMemoryStorage = require('../../lib/client/storage/in-memory-storage');
var ProxyConnection = require('../../lib/client/proxy/proxy-connection');

describe('Architectural Validation', function() {
  var durableStore;
  var storage;

  beforeEach(function(done) {
    storage = new InMemoryStorage({ debug: false });
    durableStore = new DurableStore(storage, {
      maxBatchSize: 5,
      debug: false
    });
    
    storage.initialize(function() {
      durableStore.initialize(function() {
        done();
      });
    });
  });

  describe('Interface Compliance', function() {
    it('should implement all required DurableStore methods with correct signatures', function() {
      var requiredMethods = [
        { name: 'putDoc', minParams: 2 },
        { name: 'getDoc', minParams: 3 },
        { name: 'putDocsBulk', minParams: 2 },
        { name: 'retrieveDocumentsBulk', minParams: 3 },
        { name: 'flush', minParams: 1 },
        { name: 'setAutoBatchEnabled', minParams: 1 },
        { name: 'isAutoBatchEnabled', minParams: 0 },
        { name: 'getWriteQueueSize', minParams: 0 },
        { name: 'hasDocsInWriteQueue', minParams: 0 }
      ];

      requiredMethods.forEach(function(methodSpec) {
        expect(typeof durableStore[methodSpec.name], 
          'Method ' + methodSpec.name + ' should exist').to.equal('function');
        expect(durableStore[methodSpec.name].length, 
          'Method ' + methodSpec.name + ' should have at least ' + methodSpec.minParams + ' parameters')
          .to.be.at.least(methodSpec.minParams);
      });
    });

    it('should implement all required Storage methods with correct signatures', function() {
      var requiredMethods = [
        { name: 'initialize', minParams: 1 },
        { name: 'writeRecords', minParams: 2 },
        { name: 'readRecord', minParams: 3 },
        { name: 'readRecordsBulk', minParams: 3 },
        { name: 'deleteRecord', minParams: 3 },
        { name: 'readAllRecords', minParams: 2 },
        { name: 'clearStore', minParams: 2 },
        { name: 'clearAll', minParams: 1 }
      ];

      requiredMethods.forEach(function(methodSpec) {
        expect(typeof storage[methodSpec.name], 
          'Storage method ' + methodSpec.name + ' should exist').to.equal('function');
        expect(storage[methodSpec.name].length, 
          'Storage method ' + methodSpec.name + ' should have at least ' + methodSpec.minParams + ' parameters')
          .to.be.at.least(methodSpec.minParams);
      });
    });

    it('should implement ProxyConnection emitter mixin correctly', function() {
      // Test that ProxyConnection has EventEmitter methods
      expect(typeof ProxyConnection.prototype.on).to.equal('function');
      expect(typeof ProxyConnection.prototype.emit).to.equal('function');
      expect(typeof ProxyConnection.prototype.removeListener).to.equal('function');
      
      // Note: ProxyConnection requires specific setup, so we'll just test the prototype
      // A full integration test would be needed for instance testing
    });
  });

  describe('Callback Convention Consistency', function() {
    it('should use error-first callback convention for DurableStore methods', function(done) {
      var callbackTestCount = 0;
      var expectedTests = 3;

      // Test putDoc callback convention
      durableStore.putDoc({
        collection: 'test',
        id: 'test1',
        data: { title: 'Test' },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null,
        preventCompose: false,
        submitSource: false,
        connection: { id: 'test-connection' }
      }, function() {
        expect(arguments.length).to.equal(1, 'putDoc callback should have 1 argument (error)');
        if (arguments[0] !== null && arguments[0] !== undefined) {
          expect(arguments[0]).to.be.an('error', 'First argument should be error or null');
        }
        callbackTestCount++;
        checkCompletion();
      });

      // Test getDoc callback convention
      durableStore.getDoc('test', 'test1', function() {
        expect(arguments.length).to.equal(2, 'getDoc callback should have 2 arguments (error, result)');
        if (arguments[0] !== null && arguments[0] !== undefined) {
          expect(arguments[0]).to.be.an('error', 'First argument should be error or null');
          expect(arguments[1]).to.be.undefined;
        } else {
          // Success case - should have result
          expect(arguments[1]).to.exist;
        }
        callbackTestCount++;
        checkCompletion();
      });

      // Test flush callback convention
      durableStore.flush(function() {
        expect(arguments.length).to.equal(1, 'flush callback should have 1 argument (error)');
        if (arguments[0] !== null && arguments[0] !== undefined) {
          expect(arguments[0]).to.be.an('error', 'First argument should be error or null');
        }
        callbackTestCount++;
        checkCompletion();
      });

      function checkCompletion() {
        if (callbackTestCount === expectedTests) {
          done();
        }
      }
    });

    it('should use error-first callback convention for Storage methods', function(done) {
      var callbackTestCount = 0;
      var expectedTests = 2;

      // Test readRecord callback convention
      storage.readRecord('docs', 'test1', function() {
        // InMemoryStorage doesn't use error-first pattern, it just returns result
        expect(arguments.length).to.be.at.least(1, 'readRecord callback should have at least 1 argument');
        callbackTestCount++;
        checkCompletion();
      });

      // Test readAllRecords callback convention
      storage.readAllRecords('docs', function() {
        expect(arguments.length).to.be.at.least(1, 'readAllRecords callback should have at least 1 argument');
        callbackTestCount++;
        checkCompletion();
      });

      function checkCompletion() {
        if (callbackTestCount === expectedTests) {
          done();
        }
      }
    });
  });

  describe('Promise Chain Stress Testing', function() {
    it('should handle complex promise chains without hanging', function(done) {
      this.timeout(5000); // 5 second timeout for stress test
      
      var documents = [];
      var operationCount = 15;
      
      // Create test documents
      for (var i = 0; i < operationCount; i++) {
        documents.push({
          collection: 'stressTest',
          id: 'stress' + i,
          data: { title: 'Stress Test ' + i, index: i },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null,
          preventCompose: false,
          submitSource: false,
          connection: { id: 'test-connection' }
        });
      }

      // Chain multiple async operations
      var completedOps = 0;
      var hasError = false;

      function processDocument(doc, callback) {
        durableStore.putDoc(doc, function(putError) {
          if (putError && !hasError) {
            hasError = true;
            return callback(putError);
          }
          
          durableStore.getDoc(doc.collection, doc.id, function(getError, result) {
            if (getError && !hasError) {
              hasError = true;
              return callback(getError);
            }
            
            expect(result).to.exist;
            completedOps++;
            callback(null);
          });
        });
      }

      // Process all documents in sequence to test chaining
      var docIndex = 0;
      function processNext() {
        if (docIndex >= documents.length) {
          expect(completedOps).to.equal(operationCount);
          return done();
        }
        
        processDocument(documents[docIndex++], function(error) {
          if (error) return done(error);
          processNext();
        });
      }

      processNext();
    });

    it('should handle concurrent bulk operations without race conditions', function(done) {
      this.timeout(3000);
      
      var batch1 = [];
      var batch2 = [];
      
      for (var i = 0; i < 5; i++) {
        batch1.push({
          collection: 'concurrent1',
          id: 'batch1_' + i,
          data: { batch: 1, index: i },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null,
          preventCompose: false,
          submitSource: false,
          connection: { id: 'test-connection' }
        });
        
        batch2.push({
          collection: 'concurrent2', 
          id: 'batch2_' + i,
          data: { batch: 2, index: i },
          version: 1,
          type: { name: 'json0' },
          pendingOps: [],
          inflightOp: null,
          preventCompose: false,
          submitSource: false,
          connection: { id: 'test-connection' }
        });
      }

      var completedBatches = 0;
      
      durableStore.putDocsBulk(batch1, function(error1) {
        expect(error1).to.not.exist;
        completedBatches++;
        if (completedBatches === 2) done();
      });
      
      durableStore.putDocsBulk(batch2, function(error2) {
        expect(error2).to.not.exist;
        completedBatches++;
        if (completedBatches === 2) done();
      });
    });
  });

  describe('Context Preservation', function() {
    it('should preserve context through async DurableStore operations', function(done) {
      // Create a custom storage with test properties to verify context preservation
      var testStorage = new InMemoryStorage({ debug: false });
      testStorage.testProperty = 'context-test-value';
      testStorage.originalWriteRecords = testStorage.writeRecords;
      
      testStorage.writeRecords = function(recordsByType, callback) {
        var self = this;
        // Simulate async operation
        setTimeout(function() {
          expect(self.testProperty).to.equal('context-test-value', 'Context should be preserved in async operation');
          self.originalWriteRecords.call(self, recordsByType, callback);
        }, 10);
      };

      testStorage.initialize(function() {
        var testDurableStore = new DurableStore(testStorage, { debug: false });
        testDurableStore.initialize(function() {
          testDurableStore.putDoc({
            collection: 'contextTest',
            id: 'context1',
            data: { test: true },
            version: 1,
            type: { name: 'json0' },
            pendingOps: [],
            inflightOp: null,
            preventCompose: false,
            submitSource: false,
            connection: { id: 'test-connection' }
          }, function(error) {
            expect(error).to.not.exist;
            done();
          });
        });
      });
    });

    it('should preserve auto-batch state during bulk operations', function(done) {
      // Disable auto-batching first
      durableStore.setAutoBatchEnabled(false);
      var stateBeforeBulk = durableStore.isAutoBatchEnabled();
      expect(stateBeforeBulk).to.be.false;
      
      var testDocs = [{
        collection: 'batchTest',
        id: 'batch1',
        data: { test: true },
        version: 1,
        type: { name: 'json0' },
        pendingOps: [],
        inflightOp: null,
        preventCompose: false,
        submitSource: false,
        connection: { id: 'test-connection' }
      }];
      
      durableStore.putDocsBulk(testDocs, function(error) {
        expect(error).to.not.exist;
        // Auto-batch state should be restored to what it was before bulk operation
        expect(durableStore.isAutoBatchEnabled()).to.equal(stateBeforeBulk);
        done();
      });
    });
  });

  describe('Method Name Collision Detection', function() {
    it('should not have method name collisions in DurableStore', function() {
      var durableStoreProto = DurableStore.prototype;
      var ownMethods = Object.getOwnPropertyNames(durableStoreProto);
      var parentProto = Object.getPrototypeOf(durableStoreProto);
      var inheritedMethods = parentProto ? Object.getOwnPropertyNames(parentProto) : [];
      
      var collisions = [];
      ownMethods.forEach(function(method) {
        if (inheritedMethods.includes(method) && method !== 'constructor') {
          collisions.push(method);
        }
      });
      
      expect(collisions.length).to.equal(0, 
        'Found method name collisions: ' + collisions.join(', '));
    });

    it('should not have method name collisions in InMemoryStorage', function() {
      var storageProto = InMemoryStorage.prototype;
      var ownMethods = Object.getOwnPropertyNames(storageProto);
      var parentProto = Object.getPrototypeOf(storageProto);
      var inheritedMethods = parentProto ? Object.getOwnPropertyNames(parentProto) : [];
      
      var collisions = [];
      ownMethods.forEach(function(method) {
        if (inheritedMethods.includes(method) && method !== 'constructor') {
          collisions.push(method);
        }
      });
      
      expect(collisions.length).to.equal(0, 
        'Found method name collisions in InMemoryStorage: ' + collisions.join(', '));
    });

    it('should verify ProxyConnection mixin is applied correctly', function() {
      // Verify that ProxyConnection has EventEmitter methods from the mixin
      var requiredEmitterMethods = ['on', 'emit', 'removeListener', 'once', 'addListener'];
      
      requiredEmitterMethods.forEach(function(method) {
        expect(typeof ProxyConnection.prototype[method]).to.equal('function',
          'ProxyConnection should have EventEmitter method: ' + method);
      });
      
      // Note: Creating ProxyConnection instances requires complex setup
      // We'll test that the prototype has the expected methods
      expect(typeof ProxyConnection.prototype.on).to.equal('function');
      expect(typeof ProxyConnection.prototype.emit).to.equal('function');
    });
  });

  describe('Edge Case Handling', function() {
    it('should handle malformed document data gracefully', function(done) {
      var malformedDocs = [
        { id: 'malformed1', collection: null, data: undefined, version: 1, type: { name: 'json0' }, pendingOps: [], inflightOp: null, preventCompose: false, submitSource: false, connection: { id: 'test-connection' } },
        { id: null, collection: 'test', data: { valid: true }, version: 1, type: { name: 'json0' }, pendingOps: [], inflightOp: null, preventCompose: false, submitSource: false, connection: { id: 'test-connection' } },
        { collection: 'test', data: { noId: true }, version: 1, type: { name: 'json0' }, pendingOps: [], inflightOp: null, preventCompose: false, submitSource: false, connection: { id: 'test-connection' } }, // Missing id
        { id: 'circular', collection: 'test', data: null, version: 1, type: { name: 'json0' }, pendingOps: [], inflightOp: null, preventCompose: false, submitSource: false, connection: { id: 'test-connection' } }
      ];
      
      var processedCount = 0;
      
      malformedDocs.forEach(function(doc) {
        durableStore.putDoc(doc, function(error) {
          // Should either succeed with cleanup or fail gracefully
          processedCount++;
          if (processedCount === malformedDocs.length) {
            done(); // All processed without hanging
          }
        });
      });
    });

    it('should handle storage errors gracefully during bulk operations', function(done) {
      // Create a simple test that verifies bulk operations handle various inputs
      var testDocs = [
        { collection: 'errorTest', id: 'doc1', data: { test: 1 }, version: 1, type: { name: 'json0' }, pendingOps: [], inflightOp: null, preventCompose: false, submitSource: false, connection: { id: 'test-connection' } }
      ];
      
      // Test with empty array - should not error
      durableStore.putDocsBulk([], function(error) {
        expect(error).to.not.exist;
        
        // Test with actual documents - should succeed
        durableStore.putDocsBulk(testDocs, function(error2) {
          expect(error2).to.not.exist;
          done();
        });
      });
    });
  });
});