var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var DurableStore = require('../../../lib/client/durable-store');

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
      
      // Simulate realistic network delay
      var delay = Math.random() * 20 + 5; // 5-25ms delay
      
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
        sharedWorkerManager.realConnection = new Connection();
        sharedWorkerManager.durableStore = durableStore;
        sharedWorkerManager.realConnection.durableStore = durableStore;
        
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
        setTimeout(callback, 50); // Allow connections to settle
      } else {
        setTimeout(checkReady, 10);
      }
    };
    
    checkReady();
  }
  
  describe('Basic Multi-Tab Synchronization', function() {
    it('should synchronize document creation across 3 tabs', function(done) {
      var tab1 = createTab('Editor Tab');
      var tab2 = createTab('Viewer Tab'); 
      var tab3 = createTab('Mobile Tab');
      
      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('documents', 'shared-doc');
        var doc2 = tab2.getDoc('documents', 'shared-doc');
        var doc3 = tab3.getDoc('documents', 'shared-doc');
        
        var createEvents = 0;
        var expectedCreateEvents = 3; // One for each tab
        
        function checkCompletion() {
          createEvents++;
          if (createEvents === expectedCreateEvents) {
            // Verify all tabs have the same data
            expect(doc1.data).to.deep.equal(doc2.data);
            expect(doc2.data).to.deep.equal(doc3.data);
            expect(doc1.data.title).to.equal('Shared Document');
            
            // Verify event logs
            tabs.forEach(function(tab) {
              var createEvent = tab.eventLog.find(function(e) {
                return e.type === 'create' && e.collection === 'documents' && e.id === 'shared-doc';
              });
              expect(createEvent).to.exist;
            });
            
            done();
          }
        }
        
        // Subscribe all documents
        doc1.subscribe(function() {
          doc2.subscribe(function() {
            doc3.subscribe(function() {
              // Create document in tab1
              doc1.create({
                title: 'Shared Document',
                author: 'Tab 1',
                content: 'This document is shared across all tabs'
              });
              
              // Set up create event listeners
              doc1.on('create', checkCompletion);
              doc2.on('create', checkCompletion);
              doc3.on('create', checkCompletion);
            });
          });
        });
      });
    });
    
    it('should handle collaborative editing between 5 tabs', function(done) {
      var tabCount = 5;
      var operationsPerTab = 3;
      var totalExpectedOps = tabCount * operationsPerTab;
      
      // Create multiple tabs
      for (var i = 1; i <= tabCount; i++) {
        createTab('Tab ' + i);
      }
      
      waitForAllTabs(function() {
        var docs = tabs.map(function(tab) {
          return tab.getDoc('collaborative', 'edit-doc');
        });
        
        var totalOpsReceived = 0;
        
        function checkCompletion() {
          totalOpsReceived++;
          
          if (totalOpsReceived === totalExpectedOps * tabCount) {
            // All tabs should have received all operations
            var finalData = docs[0].data;
            
            // Verify all tabs have identical data
            docs.forEach(function(doc, index) {
              expect(doc.data).to.deep.equal(finalData);
              expect(doc.data.edits).to.have.length(totalExpectedOps);
            });
            
            // Verify edit contributions from all tabs
            var editsByTab = {};
            finalData.edits.forEach(function(edit) {
              editsByTab[edit.source] = (editsByTab[edit.source] || 0) + 1;
            });
            
            expect(Object.keys(editsByTab)).to.have.length(tabCount);
            
            done();
          }
        }
        
        // Subscribe all documents and set up op listeners
        var subscriptionPromises = docs.map(function(doc) {
          return new Promise(function(resolve) {
            doc.subscribe(resolve);
            doc.on('op', checkCompletion);
          });
        });
        
        Promise.all(subscriptionPromises).then(function() {
          // Create initial document
          docs[0].create({
            title: 'Collaborative Document',
            edits: []
          }, function() {
            // Each tab makes multiple edits
            tabs.forEach(function(tab, tabIndex) {
              for (var opIndex = 0; opIndex < operationsPerTab; opIndex++) {
                setTimeout(function() {
                  var doc = tab.getDoc('collaborative', 'edit-doc');
                  var editIndex = doc.data.edits.length;
                  
                  doc.submitOp([{
                    p: ['edits', editIndex],
                    li: {
                      source: tab.name,
                      text: 'Edit from ' + tab.name + ' #' + (opIndex + 1),
                      timestamp: Date.now()
                    }
                  }]);
                }, (tabIndex * operationsPerTab + opIndex) * 50);
              }
            });
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
          doc1.create({ viewers: 1 });
          
          // Add more tabs dynamically
          var tab2 = createTab('Dynamic Tab 2');
          var tab3 = createTab('Dynamic Tab 3');
          
          setTimeout(function() {
            var doc2 = tab2.getDoc('lifecycle', 'persistent-doc');
            var doc3 = tab3.getDoc('lifecycle', 'persistent-doc');
            
            doc2.subscribe(function() {
              doc3.subscribe(function() {
                // Update viewer count
                doc1.submitOp([{
                  p: ['viewers'],
                  na: 2 // Add 2 viewers
                }]);
                
                setTimeout(function() {
                  // Verify all tabs see the update
                  expect(doc1.data.viewers).to.equal(3);
                  expect(doc2.data.viewers).to.equal(3);
                  expect(doc3.data.viewers).to.equal(3);
                  
                  // Close tab2
                  tab2.connection.close();
                  
                  // Update again from remaining tab
                  setTimeout(function() {
                    doc3.submitOp([{
                      p: ['viewers'],
                      na: -1 // Remove 1 viewer
                    }]);
                    
                    setTimeout(function() {
                      // Remaining tabs should be synchronized
                      expect(doc1.data.viewers).to.equal(2);
                      expect(doc3.data.viewers).to.equal(2);
                      
                      done();
                    }, 100);
                  }, 100);
                }, 100);
              });
            });
          }, 100);
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
            data: 'This should survive tab closure'
          });
          
          // Wait for data to be persisted
          setTimeout(function() {
            // Close the tab
            tab1.connection.close();
            tabs = []; // Clear tabs array
            
            // Create new tab and verify document persists
            setTimeout(function() {
              var newTab = createTab('New Tab');
              
              setTimeout(function() {
                var newDoc = newTab.getDoc('persistence', 'saved-doc');
                
                newDoc.subscribe(function() {
                  // Document should have persisted data
                  expect(newDoc.data).to.exist;
                  expect(newDoc.data.title).to.equal('Persistent Document');
                  expect(newDoc.data.data).to.equal('This should survive tab closure');
                  
                  done();
                });
              }, 100);
            }, 100);
          }, 200);
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
        // Disable auto-flush from tab2
        tab2.connection.setAutoFlush(false);
        
        setTimeout(function() {
          // Should affect SharedWorker's real connection
          expect(sharedWorkerManager.realConnection.isAutoFlush()).to.be.false;
          
          // Create documents in tab1 (should be queued)
          var doc1 = tab1.getDoc('flush-test', 'doc1');
          var doc2 = tab1.getDoc('flush-test', 'doc2');
          
          doc1.create({ title: 'Queued Doc 1' });
          doc2.create({ title: 'Queued Doc 2' });
          
          setTimeout(function() {
            // Documents should be queued in SharedWorker
            expect(sharedWorkerManager.durableStore.hasDocsInWriteQueue()).to.be.true;
            
            // Flush from tab2
            tab2.connection.flushWrites(function() {
              // Queue should be empty after flush
              expect(sharedWorkerManager.durableStore.hasDocsInWriteQueue()).to.be.false;
              
              // Re-enable auto-flush
              tab2.connection.setAutoFlush(true);
              
              setTimeout(function() {
                expect(sharedWorkerManager.realConnection.isAutoFlush()).to.be.true;
                done();
              }, 50);
            });
          }, 100);
        }, 50);
      });
    });
  });
  
  describe('Error Handling in Multi-Tab Scenario', function() {
    it('should recover gracefully when SharedWorker becomes unavailable', function(done) {
      var tab1 = createTab('Resilient Tab 1');
      var tab2 = createTab('Resilient Tab 2');
      
      waitForAllTabs(function() {
        var doc1 = tab1.getDoc('resilience', 'test-doc');
        var doc2 = tab2.getDoc('resilience', 'test-doc');
        
        doc1.subscribe(function() {
          doc2.subscribe(function() {
            doc1.create({ status: 'operational' });
            
            setTimeout(function() {
              // Simulate SharedWorker becoming unavailable
              // by clearing the message channels
              channels['multi-tab-test'] = [];
              
              // Tabs should handle this gracefully
              var errors = 0;
              var errorHandler = function() {
                errors++;
              };
              
              tab1.connection.on('error', errorHandler);
              tab2.connection.on('error', errorHandler);
              
              // Try to perform operations (should timeout or error gracefully)
              doc1.submitOp([{
                p: ['status'],
                oi: 'degraded'
              }]);
              
              // Don't wait forever
              setTimeout(function() {
                console.log('SharedWorker unavailability test completed with', errors, 'errors');
                done(); // Test passes if it doesn't hang
              }, 1000);
            }, 100);
          });
        });
      });
    });
    
    it('should handle message delivery failures gracefully', function(done) {
      var tab1 = createTab('Flaky Network Tab');
      
      waitForAllTabs(function() {
        var originalPostMessage = MockBroadcastChannel.prototype.postMessage;
        var messageFailures = 0;
        
        // Simulate unreliable message delivery
        MockBroadcastChannel.prototype.postMessage = function(message) {
          if (Math.random() < 0.3) { // 30% failure rate
            messageFailures++;
            console.log('Simulated message delivery failure:', messageFailures);
            return; // Drop the message
          }
          
          originalPostMessage.call(this, message);
        };
        
        var doc1 = tab1.getDoc('flaky', 'network-test');
        
        doc1.subscribe(function(error) {
          if (error) {
            console.log('Subscribe failed due to network simulation:', error);
          }
          
          // Even with failures, the system should eventually work
          // or provide appropriate error handling
          
          // Restore normal message delivery
          MockBroadcastChannel.prototype.postMessage = originalPostMessage;
          
          console.log('Network reliability test completed with', messageFailures, 'simulated failures');
          done();
        });
        
        // Safety timeout
        setTimeout(function() {
          MockBroadcastChannel.prototype.postMessage = originalPostMessage;
          done();
        }, 2000);
      });
    });
  });
  
  describe('Performance Under Load', function() {
    it('should handle many tabs with many documents efficiently', function(done) {
      this.timeout(10000); // Increase timeout for performance test
      
      var tabCount = 10;
      var docsPerTab = 5;
      var totalDocs = tabCount * docsPerTab;
      
      // Create many tabs
      for (var i = 1; i <= tabCount; i++) {
        createTab('Load Test Tab ' + i);
      }
      
      waitForAllTabs(function() {
        var startTime = Date.now();
        var completedOperations = 0;
        
        function checkCompletion() {
          completedOperations++;
          
          if (completedOperations === totalDocs) {
            var duration = Date.now() - startTime;
            console.log('Created', totalDocs, 'documents across', tabCount, 'tabs in', duration, 'ms');
            
            // Verify memory usage is reasonable
            var workerStats = sharedWorkerManager.getStats();
            console.log('SharedWorker stats after load test:', workerStats);
            
            expect(workerStats.activeTabs).to.equal(tabCount);
            expect(workerStats.documentSubscriptions).to.be.greaterThan(0);
            
            done();
          }
        }
        
        // Each tab creates multiple documents
        tabs.forEach(function(tab, tabIndex) {
          for (var docIndex = 0; docIndex < docsPerTab; docIndex++) {
            var docId = 'load-doc-' + tabIndex + '-' + docIndex;
            var doc = tab.getDoc('load-test', docId);
            
            doc.subscribe(function() {
              doc.create({
                tabIndex: tabIndex,
                docIndex: docIndex,
                created: Date.now()
              });
              
              checkCompletion();
            });
          }
        });
      });
    });
  });
});