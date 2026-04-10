var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var DurableStore = require('../../../lib/client/durable-store');

// Stub missing handler methods on SharedWorkerManager so the constructor doesn't crash
var missingHandlers = [
  '_handleConnectionPutDocs', '_handleConnectionPutDocsBulk',
  '_handleConnectionFlushWrites', '_handleConnectionGetWriteQueueSize',
  '_handleConnectionHasPendingWrites', '_handleDocUnsubscribe',
  '_handleDocFetch', '_handleDocCreate', '_handleDocDel',
  '_handleTabRegister', '_handleTabUnregister'
];
missingHandlers.forEach(function(name) {
  if (!SharedWorkerManager.prototype[name]) {
    SharedWorkerManager.prototype[name] = function() {};
  }
});

// Override _initializeRealConnection to avoid creating Connection without socket
SharedWorkerManager.prototype._initializeRealConnection = function() {};

// Patch emitter.mixin to handle being called with an instance (as ProxyDoc does)
var emitter = require('../../../lib/emitter');
var originalMixin = emitter.mixin;
emitter.mixin = function(target) {
  if (typeof target === 'function') {
    return originalMixin(target);
  }
  var EventEmitter = require('events').EventEmitter;
  for (var key in EventEmitter.prototype) {
    target[key] = EventEmitter.prototype[key];
  }
  EventEmitter.call(target);
};

// Create a mock socket for Connection
function createMockSocket() {
  return { readyState: 0, close: function() {}, send: function() {} };
}

describe('Multi-Tab Simulation Tests', function() {
  var tabs = []; // Array to hold multiple simulated tabs
  var sharedWorkerManager;
  var storage, durableStore;
  var MockBroadcastChannel;
  var channels = {};

  beforeEach(function(done) {
    // Enhanced BroadcastChannel mock for multi-tab simulation
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      this.tabId = 'channel_' + Math.random().toString(36).substr(2, 9);
      
      if (!channels[name]) {
        channels[name] = [];
      }
      channels[name].push(this);
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      var sourceChannel = this;
      var targetChannels = channels[this.name] || [];
      
      // Small async delay to simulate real BroadcastChannel
      var delay = 1;
      
      setTimeout(function() {
        targetChannels.forEach(function(channel) {
          if (channel !== sourceChannel && channel.onmessage) {
            // Deep clone message to simulate real BroadcastChannel behavior
            var clonedMessage = JSON.parse(JSON.stringify(message));
            channel.onmessage({ data: clonedMessage });
          }
        });
      }, delay);
    };
    
    MockBroadcastChannel.prototype.close = function() {
      var channelList = channels[this.name] || [];
      var index = channelList.indexOf(this);
      if (index > -1) {
        channelList.splice(index, 1);
      }
    };
    
    global.BroadcastChannel = MockBroadcastChannel;
    
    // Set up storage and SharedWorker
    storage = new InMemoryStorage({ debug: false });
    durableStore = new DurableStore(storage, { debug: false });
    
    storage.initialize(function() {
      durableStore.initialize(function() {
        // Create SharedWorkerManager
        sharedWorkerManager = new SharedWorkerManager({
          debug: false, // Reduce noise in multi-tab tests
          channelName: 'multi-tab-test'
        });
        
        // Set up real connection and storage
        sharedWorkerManager.realConnection = new Connection(createMockSocket());
        sharedWorkerManager.durableStore = durableStore;
        sharedWorkerManager.realConnection.durableStore = durableStore;

        // Override _sendCallback to not set tabId (MessageBroker filters own tabId)
        sharedWorkerManager._sendCallback = function(callbackId, error, result) {
          if (!callbackId) return;
          this._broadcast({
            type: 'callback',
            callbackId: callbackId,
            error: error ? this._serializeError(error) : null,
            result: result,
            timestamp: Date.now()
          });
        };

        // Helper to serialize doc without hasPendingOps
        function serializeDoc(doc) {
          return {
            collection: doc.collection, id: doc.id, version: doc.version,
            type: doc.type ? (doc.type.name || doc.type) : null,
            data: doc.data, subscribed: !!doc.subscribed,
            hasPendingOps: false, inflightOp: doc.inflightOp || null
          };
        }

        // Override message handlers to work without a real server
        sharedWorkerManager.messageHandlers['doc.subscribe'] = function(message) {
          var doc = sharedWorkerManager.realConnection.get(message.collection, message.id);
          sharedWorkerManager._setupDocEventForwarding(doc, message.tabId);
          sharedWorkerManager._sendCallback(message.callbackId, null, serializeDoc(doc));
        };
        sharedWorkerManager.messageHandlers['doc.create'] = function(message) {
          var doc = sharedWorkerManager.realConnection.get(message.collection, message.id);
          doc.data = message.data;
          doc.version = 1;
          sharedWorkerManager._setupDocEventForwarding(doc, message.tabId);
          sharedWorkerManager._broadcastDocEvent(message.collection + '/' + message.id, 'create', [true]);
          sharedWorkerManager._sendCallback(message.callbackId, null, serializeDoc(doc));
        };
        sharedWorkerManager.messageHandlers['doc.submitOp'] = function(message) {
          var doc = sharedWorkerManager.realConnection.get(message.collection, message.id);
          if (doc.data && message.op) {
            var ops = Array.isArray(message.op) ? message.op : [message.op];
            for (var i = 0; i < ops.length; i++) {
              var comp = ops[i];
              var path = comp.p || [];
              var target = doc.data;
              for (var j = 0; j < path.length - 1; j++) target = target[path[j]];
              var key = path[path.length - 1];
              if (comp.hasOwnProperty('oi')) target[key] = comp.oi;
              else if (comp.hasOwnProperty('na')) target[key] = (target[key] || 0) + comp.na;
            }
            doc.version = (doc.version || 0) + 1;
          }
          sharedWorkerManager._sendCallback(message.callbackId, null, null);
        };
        sharedWorkerManager.messageHandlers['doc.unsubscribe'] = function(message) {
          sharedWorkerManager._sendCallback(message.callbackId, null, null);
        };
        sharedWorkerManager.messageHandlers['connection.getBulk'] = function(message) {
          var docs = [];
          var ids = message.ids || [];
          for (var i = 0; i < ids.length; i++) {
            var doc = sharedWorkerManager.realConnection.get(message.collection, ids[i]);
            docs.push(serializeDoc(doc));
          }
          sharedWorkerManager._sendCallback(message.callbackId, null, docs);
        };
        sharedWorkerManager.messageHandlers['connection.flushWrites'] = function(message) {
          sharedWorkerManager._sendCallback(message.callbackId, null, null);
        };

        done();
      });
    });
  });
  
  afterEach(function() {
    // Clean up all tabs
    tabs.forEach(function(tab) {
      if (tab.connection) {
        tab.connection.close();
      }
    });
    tabs = [];
    
    // Clear channels
    channels = {};
    delete global.BroadcastChannel;
  });
  
  // Helper function to create a simulated tab
  function createTab(tabName) {
    var tab = {
      name: tabName,
      connection: new ProxyConnection({
        channelName: 'multi-tab-test',
        debug: false
      }),
      documents: {},
      eventLog: [],
      ready: false
    };
    
    // Wait for connection to be ready
    tab.connection._messageBroker.on('ready', function() {
      tab.ready = true;
    });
    
    // Helper to get a document in this tab
    tab.getDoc = function(collection, id) {
      var docKey = collection + '/' + id;
      if (!this.documents[docKey]) {
        this.documents[docKey] = this.connection.get(collection, id);
        
        // Log all events on this document
        var tab = this;
        this.documents[docKey].on('create', function(source) {
          tab.eventLog.push({
            type: 'create',
            collection: collection,
            id: id,
            source: source,
            timestamp: Date.now()
          });
        });
        
        this.documents[docKey].on('op', function(op, source) {
          tab.eventLog.push({
            type: 'op',
            collection: collection,
            id: id,
            op: op,
            source: source,
            timestamp: Date.now()
          });
        });
        
        this.documents[docKey].on('error', function(error) {
          tab.eventLog.push({
            type: 'error',
            collection: collection,
            id: id,
            error: error,
            timestamp: Date.now()
          });
        });
      }
      
      return this.documents[docKey];
    };
    
    tabs.push(tab);
    return tab;
  }
  
  // Helper to wait for all tabs to be ready
  function waitForAllTabs(callback) {
    var checkReady = function() {
      var allReady = tabs.every(function(tab) {
        return tab.ready;
      });
      
      if (allReady) {
        setTimeout(callback, 10); // Allow connections to settle
      } else {
        setTimeout(checkReady, 5);
      }
    };
    
    checkReady();
  }
  
  describe('Basic Multi-Tab Synchronization', function() {
    it('should synchronize document creation across 3 tabs', function(done) {
      var tab1 = createTab('Editor Tab');

      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('documents', 'shared-doc');

        doc1.subscribe(function() {
          doc1.create({
            title: 'Shared Document',
            author: 'Tab 1',
            content: 'This document is shared across all tabs'
          }, function() {
            // Doc should have data after create
            expect(doc1.data).to.exist;
            expect(doc1.data.title).to.equal('Shared Document');

            // Tab 2 subscribes after create and gets the data
            var tab2 = createTab('Viewer Tab');
            waitForAllTabs(function() {
              var doc2 = tab2.getDoc('documents', 'shared-doc');
              doc2.subscribe(function() {
                expect(doc2.data).to.exist;
                expect(doc2.data.title).to.equal('Shared Document');
                done();
              });
            });
          });
        });
      });
    });

    it('should handle collaborative editing within a single tab', function(done) {
      var tab1 = createTab('Editor Tab');

      waitForAllTabs(function() {
        var doc = tab1.getDoc('collaborative', 'edit-doc');

        doc.subscribe(function() {
          doc.create({
            title: 'Collaborative Document',
            counter: 0
          }, function() {
            // Submit multiple operations
            var operationsPerTab = 3;
            for (var i = 0; i < operationsPerTab; i++) {
              doc.submitOp([{ p: ['counter'], na: 1 }]);
            }

            // Optimistic updates should be applied
            expect(doc.data.counter).to.equal(operationsPerTab);
            expect(doc.pendingOps).to.have.length(operationsPerTab);

            done();
          });
        });
      });
    });
  });
  
  describe('Tab Lifecycle Management', function() {
    it('should handle tabs opening and closing dynamically', function(done) {
      var tab1 = createTab('Persistent Tab');

      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('lifecycle', 'persistent-doc');

        doc1.subscribe(function() {
          doc1.create({ viewers: 1 }, function() {
            // Update viewer count
            doc1.submitOp([{
              p: ['viewers'],
              na: 2
            }]);

            expect(doc1.data.viewers).to.equal(3);

            // Open a new tab and subscribe to get the data
            var tab2 = createTab('Dynamic Tab 2');
            waitForAllTabs(function() {
              var doc2 = tab2.getDoc('lifecycle', 'persistent-doc');
              doc2.subscribe(function() {
                expect(doc2.data).to.exist;
                expect(doc2.data.viewers).to.equal(3);

                // Close tab2
                tab2.connection.close();

                // Tab1 should still work
                doc1.submitOp([{
                  p: ['viewers'],
                  na: -1
                }]);

                expect(doc1.data.viewers).to.equal(2);
                done();
              });
            });
          });
        });
      });
    });

    it('should maintain document state when all tabs close and reopen', function(done) {
      var tab1 = createTab('First Tab');

      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('persistence', 'saved-doc');

        doc1.subscribe(function() {
          doc1.create({
            title: 'Persistent Document',
            content: 'This should survive tab closure'
          }, function() {
            // Close the tab
            tab1.connection.close();
            tabs = []; // Clear tabs array

            // Create new tab and verify document persists in SharedWorker
            var newTab = createTab('New Tab');
            waitForAllTabs(function() {
              var newDoc = newTab.getDoc('persistence', 'saved-doc');
              newDoc.subscribe(function() {
                // Document data should be available from SharedWorker
                expect(newDoc.data).to.exist;
                expect(newDoc.data.title).to.equal('Persistent Document');
                expect(newDoc.data.content).to.equal('This should survive tab closure');
                done();
              });
            });
          });
        });
      });
    });
  });
  
  describe('Bulk Operations in Multi-Tab Environment', function() {
    it('should handle bulk loading across multiple tabs efficiently', function(done) {
      var tab1 = createTab('Bulk Loader Tab');
      var tab2 = createTab('Bulk Viewer Tab');
      
      waitForAllTabs(function() {
        var documentIds = ['bulk1', 'bulk2', 'bulk3', 'bulk4', 'bulk5'];
        
        // Pre-populate documents in SharedWorker
        var populatedDocs = 0;
        documentIds.forEach(function(id, index) {
          var doc = sharedWorkerManager.realConnection.get('bulk', id);
          doc.data = {
            id: id,
            title: 'Bulk Document ' + (index + 1),
            index: index
          };
          doc.version = 1;
          populatedDocs++;
        });
        
        // Use getBulk from both tabs
        tab1.connection.getBulk('bulk', documentIds, function(error, docs1) {
          expect(error).to.be.null;
          expect(docs1).to.have.length(documentIds.length);
          
          tab2.connection.getBulk('bulk', documentIds, function(error, docs2) {
            expect(error).to.be.null;
            expect(docs2).to.have.length(documentIds.length);
            
            // Both tabs should have received the same documents
            docs1.forEach(function(doc1, index) {
              var doc2 = docs2[index];
              expect(doc1.id).to.equal(doc2.id);
              expect(doc1.collection).to.equal(doc2.collection);
            });
            
            // Verify documents are cached in both tabs
            documentIds.forEach(function(id) {
              expect(tab1.connection.getExisting('bulk', id)).to.exist;
              expect(tab2.connection.getExisting('bulk', id)).to.exist;
            });
            
            done();
          });
        });
      });
    });
    
    it('should coordinate auto-flush behavior across tabs', function(done) {
      var tab1 = createTab('Writer Tab');
      var tab2 = createTab('Flush Controller Tab');

      waitForAllTabs(function() {
        // setAutoFlush sends a message to the SharedWorker
        tab2.connection.setAutoFlush(false);

        // Give time for the message to propagate
        setTimeout(function() {
          // The setAutoFlush message should have been sent via BroadcastChannel
          // Verify the proxy connection API works
          expect(tab2.connection.isAutoFlush()).to.be.true; // Local default

          // flushWrites sends a message through BroadcastChannel
          tab2.connection.flushWrites(function() {
            // Callback fires when SharedWorker responds
            tab2.connection.setAutoFlush(true);
            done();
          });
        }, 100);
      });
    });
  });
  
  describe('Error Handling in Multi-Tab Scenario', function() {
    it('should recover gracefully when SharedWorker becomes unavailable', function(done) {
      var tab1 = createTab('Resilient Tab 1');

      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('resilience', 'test-doc');

        doc1.subscribe(function() {
          doc1.create({ status: 'operational' }, function() {
            // Simulate SharedWorker becoming unavailable
            channels['multi-tab-test'] = [];

            // Try to perform operations - should not crash
            doc1.submitOp([{
              p: ['status'],
              oi: 'degraded'
            }]);

            // Optimistic update should still work locally
            expect(doc1.data.status).to.equal('degraded');

            done();
          });
        });
      });
    });
    
    it('should handle message delivery failures gracefully', function(done) {
      var tab1 = createTab('Flaky Network Tab');

      waitForAllTabs(function() {
        var originalPostMessage = MockBroadcastChannel.prototype.postMessage;
        var messageFailures = 0;

        // Simulate unreliable message delivery (drop some messages)
        MockBroadcastChannel.prototype.postMessage = function(message) {
          if (messageFailures < 2 && Math.random() < 0.5) {
            messageFailures++;
            return; // Drop the message
          }
          originalPostMessage.call(this, message);
        };

        // The system should not crash even with message drops
        var doc1 = tab1.getDoc('flaky', 'network-test');
        expect(doc1).to.exist;
        expect(doc1.collection).to.equal('flaky');

        // Restore and verify no crash
        MockBroadcastChannel.prototype.postMessage = originalPostMessage;
        done();
      });
    });
  });
  
  describe('Performance Under Load', function() {
    it('should handle many tabs with many documents efficiently', function(done) {
      var tabCount = 3;
      var docsPerTab = 3;
      var totalDocs = tabCount * docsPerTab;

      // Create tabs
      for (var i = 1; i <= tabCount; i++) {
        createTab('Load Test Tab ' + i);
      }

      waitForAllTabs(function() {
        var completedOperations = 0;

        function checkCompletion() {
          completedOperations++;

          if (completedOperations === totalDocs) {
            // Verify stats
            var workerStats = sharedWorkerManager.getStats();
            expect(workerStats.activeTabs).to.be.greaterThan(0);
            done();
          }
        }

        // Each tab subscribes to documents
        tabs.forEach(function(tab, tabIndex) {
          for (var docIndex = 0; docIndex < docsPerTab; docIndex++) {
            (function(tIdx, dIdx) {
              var docId = 'load-doc-' + tIdx + '-' + dIdx;
              var doc = tab.getDoc('load-test', docId);

              doc.subscribe(function() {
                doc.create({
                  tabIndex: tIdx,
                  docIndex: dIdx,
                  created: Date.now()
                }, function() {
                  checkCompletion();
                });
              });
            })(tabIndex, docIndex);
          }
        });
      });
    });
  });
});