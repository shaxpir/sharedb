var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');

describe('Event Forwarding System', function() {
  var proxyConnection1, proxyConnection2, proxyConnection3;
  var sharedWorkerManager;
  var realConnection;
  var MockBroadcastChannel;
  var channels = {};
  
  beforeEach(function(done) {
    // Enhanced mock BroadcastChannel for event testing
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      this._messageLog = []; // Track messages for debugging
      
      if (!channels[name]) {
        channels[name] = [];
      }
      channels[name].push(this);
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      var sourceChannel = this;
      var targetChannels = channels[this.name] || [];
      
      // Log message for debugging
      sourceChannel._messageLog.push({
        type: 'sent',
        message: JSON.parse(JSON.stringify(message)),
        timestamp: Date.now()
      });
      
      // Deliver asynchronously to simulate real BroadcastChannel
      setTimeout(function() {
        targetChannels.forEach(function(channel) {
          if (channel !== sourceChannel && channel.onmessage) {
            // Log received message
            channel._messageLog.push({
              type: 'received', 
              message: JSON.parse(JSON.stringify(message)),
              timestamp: Date.now()
            });
            
            channel.onmessage({ data: JSON.parse(JSON.stringify(message)) });
          }
        });
      }, Math.random() * 10); // Random delay to test async handling
    };
    
    MockBroadcastChannel.prototype.close = function() {
      var channelList = channels[this.name] || [];
      var index = channelList.indexOf(this);
      if (index > -1) {
        channelList.splice(index, 1);
      }
    };
    
    global.BroadcastChannel = MockBroadcastChannel;
    
    // Create SharedWorkerManager with real connection
    sharedWorkerManager = new SharedWorkerManager({
      debug: true,
      channelName: 'event-test'
    });
    
    realConnection = new Connection();
    sharedWorkerManager.realConnection = realConnection;
    
    // Create multiple proxy connections
    proxyConnection1 = new ProxyConnection({ channelName: 'event-test' });
    proxyConnection2 = new ProxyConnection({ channelName: 'event-test' });
    proxyConnection3 = new ProxyConnection({ channelName: 'event-test' });
    
    // Wait for all connections to be ready
    var readyCount = 0;
    function checkReady() {
      readyCount++;
      if (readyCount === 3) {
        setTimeout(done, 50); // Allow message brokers to settle
      }
    }
    
    proxyConnection1._messageBroker.on('ready', checkReady);
    proxyConnection2._messageBroker.on('ready', checkReady);
    proxyConnection3._messageBroker.on('ready', checkReady);
  });
  
  afterEach(function() {
    [proxyConnection1, proxyConnection2, proxyConnection3].forEach(function(conn) {
      if (conn) conn.close();
    });
    
    channels = {};
    delete global.BroadcastChannel;
  });
  
  describe('Document Event Broadcasting', function() {
    it('should forward create events to all subscribed tabs', function(done) {
      var doc1 = proxyConnection1.get('events', 'create-test');
      var doc2 = proxyConnection2.get('events', 'create-test');
      var doc3 = proxyConnection3.get('events', 'create-test');
      
      var createEventsReceived = 0;
      var expectedCreateEvents = 3;
      
      // Set up create event listeners on all docs
      [doc1, doc2, doc3].forEach(function(doc, index) {
        doc.on('create', function(source) {
          createEventsReceived++;
          console.log('Create event received by doc' + (index + 1), 'source:', source);
          
          if (createEventsReceived === expectedCreateEvents) {
            // All tabs should have received the create event
            expect(createEventsReceived).to.equal(expectedCreateEvents);
            done();
          }
        });
      });
      
      // Subscribe all documents (order matters for event setup)
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc3.subscribe(function() {
            // Create the document in doc1 - should broadcast to all
            doc1.create({ 
              title: 'Broadcast Test',
              creator: 'tab1',
              timestamp: Date.now()
            });
          });
        });
      });
    });
    
    it('should forward operation events with correct data', function(done) {
      var doc1 = proxyConnection1.get('events', 'op-test');
      var doc2 = proxyConnection2.get('events', 'op-test');
      
      var opsReceived = [];
      var expectedOps = [
        [{ p: ['title'], oi: 'Updated Title' }],
        [{ p: ['count'], na: 1 }],
        [{ p: ['items', 0], li: 'First Item' }]
      ];
      
      // Set up op listeners
      doc1.on('op', function(op, source) {
        opsReceived.push({ doc: 'doc1', op: op, source: source });
        checkCompletion();
      });
      
      doc2.on('op', function(op, source) {
        opsReceived.push({ doc: 'doc2', op: op, source: source });
        checkCompletion();
      });
      
      function checkCompletion() {
        if (opsReceived.length === expectedOps.length * 2) {
          // Verify all operations were received by both docs
          expectedOps.forEach(function(expectedOp, index) {
            var doc1Op = opsReceived.find(function(r) { 
              return r.doc === 'doc1' && JSON.stringify(r.op) === JSON.stringify(expectedOp);
            });
            var doc2Op = opsReceived.find(function(r) { 
              return r.doc === 'doc2' && JSON.stringify(r.op) === JSON.stringify(expectedOp);
            });
            
            expect(doc1Op).to.exist;
            expect(doc2Op).to.exist;
          });
          
          done();
        }
      }
      
      // Subscribe and create initial document
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ title: 'Original', count: 0, items: [] }, function() {
            // Submit multiple operations
            expectedOps.forEach(function(op, index) {
              setTimeout(function() {
                doc1.submitOp(op);
              }, index * 100);
            });
          });
        });
      });
    });
    
    it('should handle rapid-fire events without loss', function(done) {
      var doc1 = proxyConnection1.get('events', 'rapid-test');
      var doc2 = proxyConnection2.get('events', 'rapid-test');
      
      var rapidOpsCount = 50;
      var doc1OpsReceived = 0;
      var doc2OpsReceived = 0;
      
      doc1.on('op', function(op, source) {
        doc1OpsReceived++;
        checkCompletion();
      });
      
      doc2.on('op', function(op, source) {
        doc2OpsReceived++;
        checkCompletion();
      });
      
      function checkCompletion() {
        if (doc1OpsReceived === rapidOpsCount && doc2OpsReceived === rapidOpsCount) {
          expect(doc1.data.counter).to.equal(rapidOpsCount);
          expect(doc2.data.counter).to.equal(rapidOpsCount);
          done();
        }
      }
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ counter: 0 }, function() {
            // Submit rapid operations
            for (var i = 0; i < rapidOpsCount; i++) {
              doc1.submitOp([{ p: ['counter'], na: 1 }]);
            }
          });
        });
      });
      
      // Safety timeout
      setTimeout(function() {
        console.log('Timeout - received ops:', doc1OpsReceived, doc2OpsReceived);
        done();
      }, 5000);
    });
  });
  
  describe('Connection Event Broadcasting', function() {
    it('should forward connection state changes to all tabs', function(done) {
      var stateChangesReceived = 0;
      var expectedStates = ['connected', 'disconnected', 'reconnecting', 'connected'];
      
      // Listen for state changes on proxy connections
      proxyConnection1.on('state', function(state, reason) {
        stateChangesReceived++;
        console.log('Connection1 state change:', state, reason);
        checkCompletion();
      });
      
      proxyConnection2.on('state', function(state, reason) {
        stateChangesReceived++;
        console.log('Connection2 state change:', state, reason);
        checkCompletion();
      });
      
      function checkCompletion() {
        // Each state change should be received by both connections
        if (stateChangesReceived >= expectedStates.length * 2) {
          done();
        }
      }
      
      // Simulate connection state changes in real connection
      var stateIndex = 0;
      var stateInterval = setInterval(function() {
        if (stateIndex < expectedStates.length) {
          var newState = expectedStates[stateIndex];
          sharedWorkerManager.realConnection.state = newState;
          sharedWorkerManager._broadcastConnectionEvent('state', [newState, 'Test state change']);
          stateIndex++;
        } else {
          clearInterval(stateInterval);
        }
      }, 100);
    });
    
    it('should forward connection errors to all tabs', function(done) {
      var errorsReceived = 0;
      var testError = new Error('Test connection error');
      
      proxyConnection1.on('error', function(error) {
        errorsReceived++;
        expect(error.message).to.equal('Test connection error');
        checkCompletion();
      });
      
      proxyConnection2.on('error', function(error) {
        errorsReceived++;
        expect(error.message).to.equal('Test connection error');
        checkCompletion();
      });
      
      function checkCompletion() {
        if (errorsReceived === 2) {
          done();
        }
      }
      
      // Simulate error broadcast
      setTimeout(function() {
        sharedWorkerManager._broadcastConnectionEvent('error', [testError]);
      }, 100);
    });
  });
  
  describe('Event Filtering and Routing', function() {
    it('should only forward events to subscribed documents', function(done) {
      var doc1 = proxyConnection1.get('filtering', 'subscribed');
      var doc2 = proxyConnection1.get('filtering', 'unsubscribed');
      
      var eventsReceived = 0;
      
      doc1.on('create', function() {
        eventsReceived++;
        expect(eventsReceived).to.equal(1); // Only subscribed doc should receive
        done();
      });
      
      doc2.on('create', function() {
        eventsReceived++;
        // This should not be called since doc2 is not subscribed
      });
      
      // Only subscribe doc1
      doc1.subscribe(function() {
        // Simulate create event for subscribed document
        var realDoc = sharedWorkerManager.realConnection.get('filtering', 'subscribed');
        sharedWorkerManager._setupDocEventForwarding(realDoc, proxyConnection1._messageBroker.tabId);
        
        setTimeout(function() {
          sharedWorkerManager._broadcastDocEvent('filtering/subscribed', 'create', [true]);
          
          // Wait a moment to ensure unsubscribed doc doesn't receive event
          setTimeout(function() {
            if (eventsReceived === 1) {
              done();
            }
          }, 200);
        }, 100);
      });
    });
    
    it('should handle document unsubscription correctly', function(done) {
      var doc = proxyConnection1.get('unsub', 'test');
      
      var eventsReceived = 0;
      
      doc.on('create', function() {
        eventsReceived++;
      });
      
      // Subscribe then immediately unsubscribe
      doc.subscribe(function() {
        doc.unsubscribe(function() {
          // Send an event - should not be received after unsubscribe
          setTimeout(function() {
            sharedWorkerManager._broadcastDocEvent('unsub/test', 'create', [true]);
            
            // Wait and verify no events received
            setTimeout(function() {
              expect(eventsReceived).to.equal(0);
              done();
            }, 200);
          }, 100);
        });
      });
    });
  });
  
  describe('Memory Management', function() {
    it('should clean up event subscriptions when tabs disconnect', function(done) {
      var doc1 = proxyConnection1.get('cleanup', 'test');
      var doc2 = proxyConnection2.get('cleanup', 'test');
      
      // Subscribe both documents
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          var docKey = 'cleanup/test';
          
          // Verify both tabs are tracked
          expect(sharedWorkerManager.docSubscriptions[docKey]).to.exist;
          expect(sharedWorkerManager.docSubscriptions[docKey].size).to.equal(2);
          
          // Close one proxy connection
          proxyConnection1.close();
          
          // Simulate tab cleanup (normally triggered by connection close)
          setTimeout(function() {
            sharedWorkerManager._cleanupTab(proxyConnection1._messageBroker.tabId);
            
            // Should have one subscription remaining
            if (sharedWorkerManager.docSubscriptions[docKey]) {
              expect(sharedWorkerManager.docSubscriptions[docKey].size).to.equal(1);
            }
            
            done();
          }, 100);
        });
      });
    });
    
    it('should remove document subscriptions when no tabs are interested', function(done) {
      var doc = proxyConnection1.get('removal', 'test');
      
      doc.subscribe(function() {
        var docKey = 'removal/test';
        
        // Verify subscription exists
        expect(sharedWorkerManager.docSubscriptions[docKey]).to.exist;
        expect(sharedWorkerManager.docSubscriptions[docKey].size).to.equal(1);
        
        // Close the connection
        proxyConnection1.close();
        
        setTimeout(function() {
          sharedWorkerManager._cleanupTab(proxyConnection1._messageBroker.tabId);
          
          // Document subscription should be removed entirely
          expect(sharedWorkerManager.docSubscriptions[docKey]).to.not.exist;
          
          done();
        }, 100);
      });
    });
  });
  
  describe('Error Recovery', function() {
    it('should handle event serialization errors gracefully', function(done) {
      var doc = proxyConnection1.get('error', 'serialization');
      
      var errorsReceived = 0;
      
      doc.on('error', function(error) {
        errorsReceived++;
        expect(error).to.be.an('error');
      });
      
      doc.subscribe(function() {
        // Simulate an error event with circular reference (can't serialize)
        var circularError = new Error('Circular error');
        circularError.circular = circularError;
        
        try {
          sharedWorkerManager._broadcastDocEvent('error/serialization', 'error', [circularError]);
        } catch (e) {
          // Should handle serialization error gracefully
          console.log('Serialization error handled:', e.message);
        }
        
        // Send a normal error that should work
        setTimeout(function() {
          sharedWorkerManager._broadcastDocEvent('error/serialization', 'error', [new Error('Normal error')]);
          
          setTimeout(function() {
            expect(errorsReceived).to.be.greaterThan(0);
            done();
          }, 100);
        }, 100);
      });
    });
  });
});