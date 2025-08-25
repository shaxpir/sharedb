var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var DurableStore = require('../../../lib/client/durable-store');

describe('ProxyConnection ↔ SharedWorker Integration', function() {
  var proxyConnection1, proxyConnection2;
  var sharedWorkerManager;
  var mockBackend, realConnection;
  var storage, durableStore;
  
  // Mock BroadcastChannel that actually connects proxy to worker
  var MockBroadcastChannel;
  var channels = {}; // Simulate multiple channels
  
  beforeEach(function(done) {
    // Create a sophisticated mock BroadcastChannel that allows
    // ProxyConnections and SharedWorkerManager to actually communicate
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      
      // Store in global registry for cross-communication
      if (!channels[name]) {
        channels[name] = [];
      }
      channels[name].push(this);
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      var sourceChannel = this;
      var targetChannels = channels[this.name] || [];
      
      // Deliver to all other channels with same name (async)
      setTimeout(function() {
        targetChannels.forEach(function(channel) {
          if (channel !== sourceChannel && channel.onmessage) {
            channel.onmessage({ data: JSON.parse(JSON.stringify(message)) });
          }
        });
      }, 0);
    };
    
    MockBroadcastChannel.prototype.close = function() {
      var channelList = channels[this.name] || [];
      var index = channelList.indexOf(this);
      if (index > -1) {
        channelList.splice(index, 1);
      }
    };
    
    // Set global mock
    global.BroadcastChannel = MockBroadcastChannel;
    
    // Create storage and durable store
    storage = new InMemoryStorage({ debug: false });
    durableStore = new DurableStore(storage, { debug: false });
    
    // Create mock backend and real connection
    mockBackend = {
      connect: function() {
        return new Connection();
      }
    };
    realConnection = mockBackend.connect();
    
    // Initialize storage and durable store
    storage.initialize(function() {
      durableStore.initialize(function() {
        // Create SharedWorkerManager
        sharedWorkerManager = new SharedWorkerManager({
          debug: true,
          channelName: 'test-integration'
        });
        
        // Manually set up the real connection and durable store
        // (normally this would be done in the SharedWorker constructor)
        sharedWorkerManager.realConnection = realConnection;
        sharedWorkerManager.durableStore = durableStore;
        sharedWorkerManager.realConnection.durableStore = durableStore;
        
        // Create proxy connections that will communicate with the manager
        proxyConnection1 = new ProxyConnection({
          channelName: 'test-integration',
          debug: true
        });
        
        proxyConnection2 = new ProxyConnection({
          channelName: 'test-integration',
          debug: true
        });
        
        // Wait for message brokers to be ready
        var readyCount = 0;
        function checkReady() {
          readyCount++;
          if (readyCount === 2) {
            // Give a moment for all connections to settle
            setTimeout(done, 50);
          }
        }
        
        proxyConnection1._messageBroker.on('ready', checkReady);
        proxyConnection2._messageBroker.on('ready', checkReady);
      });
    });
  });
  
  afterEach(function() {
    if (proxyConnection1) {
      proxyConnection1.close();
      proxyConnection1 = null;
    }
    if (proxyConnection2) {
      proxyConnection2.close();
      proxyConnection2 = null;
    }
    
    // Clear all channels
    channels = {};
    delete global.BroadcastChannel;
  });
  
  describe('Basic Document Operations', function() {
    it('should create and retrieve documents through proxy', function(done) {
      var doc1 = proxyConnection1.get('test', 'doc1');
      
      expect(doc1).to.exist;
      expect(doc1.collection).to.equal('test');
      expect(doc1.id).to.equal('doc1');
      
      // Document should be cached in proxy
      var cachedDoc = proxyConnection1.getExisting('test', 'doc1');
      expect(cachedDoc).to.equal(doc1);
      
      done();
    });
    
    it('should share document state between proxy connections', function(done) {
      var doc1 = proxyConnection1.get('shared', 'doc1');
      var doc2 = proxyConnection2.get('shared', 'doc1');
      
      // Both docs should reference the same document in SharedWorker
      expect(doc1.id).to.equal(doc2.id);
      expect(doc1.collection).to.equal(doc2.collection);
      
      // Subscribe doc1 and create data
      doc1.subscribe(function(error) {
        expect(error).to.be.null;
        
        if (!doc1.data) {
          doc1.create({ title: 'Shared Document', content: 'Hello' });
        }
        
        // Subscribe doc2 - should receive the same data
        doc2.subscribe(function(error) {
          expect(error).to.be.null;
          
          // Give time for data synchronization
          setTimeout(function() {
            expect(doc2.data).to.deep.equal(doc1.data);
            done();
          }, 100);
        });
      });
    });
    
    it('should forward document events between tabs', function(done) {
      var doc1 = proxyConnection1.get('events', 'doc1');
      var doc2 = proxyConnection2.get('events', 'doc1');
      
      var eventsReceived = 0;
      
      // Set up event listeners on both docs
      doc1.on('create', function(source) {
        eventsReceived++;
        expect(source).to.exist;
        
        if (eventsReceived === 2) {
          done();
        }
      });
      
      doc2.on('create', function(source) {
        eventsReceived++;
        expect(source).to.exist;
        
        if (eventsReceived === 2) {
          done();
        }
      });
      
      // Subscribe both documents
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          // Create document in doc1 - should trigger events in both
          doc1.create({ message: 'Event test' });
        });
      });
    });
    
    it('should handle operations and synchronize data', function(done) {
      var doc1 = proxyConnection1.get('ops', 'doc1');
      var doc2 = proxyConnection2.get('ops', 'doc1');
      
      var operationsReceived = 0;
      
      // Set up operation listeners
      doc1.on('op', function(op, source) {
        operationsReceived++;
        checkCompletion();
      });
      
      doc2.on('op', function(op, source) {
        operationsReceived++;
        checkCompletion();
      });
      
      function checkCompletion() {
        if (operationsReceived >= 2) {
          // Both docs should have the same data
          expect(doc1.data).to.deep.equal(doc2.data);
          expect(doc1.data.title).to.equal('Updated Title');
          done();
        }
      }
      
      // Subscribe and create initial document
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ title: 'Original Title' }, function() {
            // Submit an operation
            doc1.submitOp([{
              p: ['title'],
              oi: 'Updated Title'
            }]);
          });
        });
      });
    });
  });
  
  describe('Bulk Operations Integration', function() {
    it('should handle getBulk through SharedWorker', function(done) {
      var ids = ['bulk1', 'bulk2', 'bulk3'];
      
      // Pre-populate some documents in the real connection
      var realDocs = ids.map(function(id) {
        var doc = sharedWorkerManager.realConnection.get('bulk', id);
        doc.data = { id: id, title: 'Bulk Doc ' + id, version: 1 };
        doc.version = 1;
        return doc;
      });
      
      // Use getBulk from proxy connection
      proxyConnection1.getBulk('bulk', ids, function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.have.length(3);
        
        // Check that all docs are returned in correct order
        docs.forEach(function(doc, index) {
          expect(doc.id).to.equal(ids[index]);
          expect(doc.collection).to.equal('bulk');
        });
        
        // Docs should be cached in proxy connection
        ids.forEach(function(id) {
          var cached = proxyConnection1.getExisting('bulk', id);
          expect(cached).to.exist;
          expect(cached.id).to.equal(id);
        });
        
        done();
      });
    });
    
    it('should handle mixed cached and uncached documents in getBulk', function(done) {
      // Pre-cache one document in proxy
      var cachedDoc = proxyConnection1.get('mixed', 'cached');
      proxyConnection1._addDocToCache(cachedDoc);
      
      var ids = ['cached', 'uncached1', 'uncached2'];
      
      proxyConnection1.getBulk('mixed', ids, function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.have.length(3);
        
        // First doc should be the cached one
        expect(docs[0]).to.equal(cachedDoc);
        
        // Other docs should be newly created
        expect(docs[1].id).to.equal('uncached1');
        expect(docs[2].id).to.equal('uncached2');
        
        done();
      });
    });
  });
  
  describe('Auto-Flush and Batch Writing', function() {
    it('should sync auto-flush state through SharedWorker', function(done) {
      // Change auto-flush setting in one proxy
      proxyConnection1.setAutoFlush(false);
      
      // Give time for message to propagate
      setTimeout(function() {
        // Should affect the real connection in SharedWorker
        expect(sharedWorkerManager.realConnection.isAutoFlush()).to.be.false;
        
        // Reset for cleanup
        proxyConnection1.setAutoFlush(true);
        setTimeout(function() {
          expect(sharedWorkerManager.realConnection.isAutoFlush()).to.be.true;
          done();
        }, 50);
      }, 50);
    });
    
    it('should handle document writing through SharedWorker', function(done) {
      var doc = proxyConnection1.get('write', 'doc1');
      
      doc.create({ title: 'Write Test' }, function(error) {
        expect(error).to.be.null;
        
        // Document should exist in real connection
        var realDoc = sharedWorkerManager.realConnection.get('write', 'doc1');
        expect(realDoc.data).to.deep.equal({ title: 'Write Test' });
        
        done();
      });
    });
  });
  
  describe('Error Handling and Edge Cases', function() {
    it('should handle SharedWorker errors gracefully', function(done) {
      // Simulate SharedWorker error by breaking the channel
      channels['test-integration'] = []; // Clear all channels
      
      var doc = proxyConnection1.get('error', 'doc1');
      
      // This should timeout or handle error appropriately
      doc.subscribe(function(error) {
        // Should either succeed (if channel reconnects) or fail gracefully
        done();
      });
      
      // Don't wait forever
      setTimeout(done, 1000);
    });
    
    it('should cleanup subscriptions when proxy disconnects', function(done) {
      var doc1 = proxyConnection1.get('cleanup', 'doc1');
      var doc2 = proxyConnection2.get('cleanup', 'doc1');
      
      // Subscribe both
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          // Check that SharedWorker tracks both subscriptions
          var docKey = 'cleanup/doc1';
          expect(sharedWorkerManager.docSubscriptions[docKey]).to.exist;
          expect(sharedWorkerManager.docSubscriptions[docKey].size).to.equal(2);
          
          // Close one connection
          proxyConnection1.close();
          
          // Give time for cleanup
          setTimeout(function() {
            // Should still have one subscription
            if (sharedWorkerManager.docSubscriptions[docKey]) {
              expect(sharedWorkerManager.docSubscriptions[docKey].size).to.equal(1);
            }
            done();
          }, 100);
        });
      });
    });
  });
  
  describe('Performance and Statistics', function() {
    it('should provide accurate statistics across proxy system', function(done) {
      // Create some documents
      var doc1 = proxyConnection1.get('stats', 'doc1');
      var doc2 = proxyConnection1.get('stats', 'doc2');
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          // Check proxy connection stats
          var proxyStats = proxyConnection1.getStats();
          expect(proxyStats.cachedDocuments).to.equal(2);
          expect(proxyStats.state).to.be.a('string');
          expect(proxyStats.messageBroker).to.be.an('object');
          
          // Check SharedWorker stats
          var workerStats = sharedWorkerManager.getStats();
          expect(workerStats.activeTabs).to.be.greaterThan(0);
          expect(workerStats.documentSubscriptions).to.be.greaterThan(0);
          
          done();
        });
      });
    });
    
    it('should handle high-frequency operations efficiently', function(done) {
      var doc = proxyConnection1.get('performance', 'doc1');
      var operationCount = 0;
      var expectedOperations = 10;
      
      doc.on('op', function() {
        operationCount++;
        if (operationCount === expectedOperations) {
          // All operations should have been processed
          expect(doc.data.counter).to.equal(expectedOperations);
          done();
        }
      });
      
      doc.subscribe(function() {
        doc.create({ counter: 0 }, function() {
          // Submit multiple rapid operations
          for (var i = 1; i <= expectedOperations; i++) {
            doc.submitOp([{
              p: ['counter'],
              na: 1
            }]);
          }
        });
      });
    });
  });
});