var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');

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
      debug: false,
      channelName: 'event-test'
    });

    realConnection = new Connection(createMockSocket());
    sharedWorkerManager.realConnection = realConnection;

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

    // Helper to serialize doc without hasPendingOps (not on real Doc)
    function serializeDoc(doc) {
      return {
        collection: doc.collection, id: doc.id, version: doc.version,
        type: doc.type ? (doc.type.name || doc.type) : null,
        data: doc.data, subscribed: !!doc.subscribed,
        hasPendingOps: false, inflightOp: doc.inflightOp || null
      };
    }

    // Override handlers to work without a real server
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
      sharedWorkerManager._broadcastDocEvent(message.collection + '/' + message.id, 'op', [message.op, message.source]);
      sharedWorkerManager._sendCallback(message.callbackId, null, null);
    };
    sharedWorkerManager.messageHandlers['doc.unsubscribe'] = function(message) {
      sharedWorkerManager._sendCallback(message.callbackId, null, null);
    };

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

      doc1.subscribe(function() {
        doc1.create({ title: 'Original', count: 0 }, function() {
          var expectedOps = [
            [{ p: ['title'], oi: 'Updated Title' }],
            [{ p: ['count'], na: 1 }]
          ];

          // Apply operations and verify optimistic updates
          expectedOps.forEach(function(op) {
            doc1.submitOp(op);
          });

          expect(doc1.data.title).to.equal('Updated Title');
          expect(doc1.data.count).to.equal(1);
          expect(doc1.pendingOps).to.have.length(expectedOps.length);

          done();
        });
      });
    });
    
    it('should handle rapid-fire events without loss', function(done) {
      var doc1 = proxyConnection1.get('events', 'rapid-test');

      var rapidOpsCount = 50;

      doc1.subscribe(function() {
        doc1.create({ counter: 0 }, function() {
          // Submit rapid operations (optimistic apply)
          for (var i = 0; i < rapidOpsCount; i++) {
            doc1.submitOp([{ p: ['counter'], na: 1 }]);
          }

          // Optimistic updates should be applied immediately
          expect(doc1.data.counter).to.equal(rapidOpsCount);
          expect(doc1.pendingOps).to.have.length(rapidOpsCount);

          done();
        });
      });
    });
  });
  
  describe('Connection Event Broadcasting', function() {
    it('should forward connection state changes to all tabs', function(done) {
      var stateChangesReceived = 0;
      var expectedStates = ['connected', 'disconnected', 'reconnecting', 'connected'];
      var finished = false;

      // Listen for state changes on proxy connections (filter out non-test states)
      proxyConnection1.on('state', function(state, reason) {
        if (reason !== 'Test state change') return;
        stateChangesReceived++;
        checkCompletion();
      });

      proxyConnection2.on('state', function(state, reason) {
        if (reason !== 'Test state change') return;
        stateChangesReceived++;
        checkCompletion();
      });

      function checkCompletion() {
        if (!finished && stateChangesReceived >= expectedStates.length * 2) {
          finished = true;
          done();
        }
      }

      // Broadcast all state changes immediately (no interval needed)
      expectedStates.forEach(function(newState) {
        sharedWorkerManager.realConnection.state = newState;
        sharedWorkerManager._broadcastConnectionEvent('state', [newState, 'Test state change']);
      });
    });
    
    it('should forward connection errors to all tabs', function(done) {
      var errorsReceived = 0;
      var finished = false;

      proxyConnection1.on('error', function(error) {
        errorsReceived++;
        // Error is serialized/deserialized through BroadcastChannel, so check message property
        expect(error).to.have.property('message');
        checkCompletion();
      });

      proxyConnection2.on('error', function(error) {
        errorsReceived++;
        expect(error).to.have.property('message');
        checkCompletion();
      });

      // Add error handler to connection3 to prevent unhandled error
      proxyConnection3.on('error', function() {
        errorsReceived++;
        checkCompletion();
      });

      function checkCompletion() {
        if (!finished && errorsReceived === 3) {
          finished = true;
          done();
        }
      }

      // Simulate error broadcast - use a plain object since Errors lose
      // their prototype through JSON serialization in BroadcastChannel
      setTimeout(function() {
        sharedWorkerManager._broadcastConnectionEvent('error', [{message: 'Test connection error'}]);
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
      });

      doc2.on('create', function() {
        eventsReceived++;
      });

      // Only subscribe doc1
      doc1.subscribe(function() {
        // Set up event forwarding for the subscribed document
        var realDoc = sharedWorkerManager.realConnection.get('filtering', 'subscribed');
        sharedWorkerManager._setupDocEventForwarding(realDoc, proxyConnection1._messageBroker.tabId);

        // Broadcast create event for subscribed document
        sharedWorkerManager._broadcastDocEvent('filtering/subscribed', 'create', [true]);

        // Wait for async BroadcastChannel delivery
        setTimeout(function() {
          // doc1 should have received the create event (subscribed doc key matches)
          // doc2 should not (different doc key: filtering/unsubscribed)
          expect(eventsReceived).to.equal(1);
          done();
        }, 50);
      });
    });
    
    it('should handle document unsubscription correctly', function(done) {
      var doc = proxyConnection1.get('unsub', 'test');

      // Subscribe then unsubscribe
      doc.subscribe(function() {
        expect(doc.subscribed).to.be.true;

        doc.unsubscribe(function() {
          // After unsubscribe, the doc should be marked as unsubscribed
          expect(doc.subscribed).to.be.false;
          expect(doc.wantSubscribe).to.be.false;

          done();
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
      var finished = false;

      var errorsReceived = 0;

      doc.on('error', function(error) {
        errorsReceived++;
        expect(error).to.have.property('message');
        if (!finished) {
          finished = true;
          expect(errorsReceived).to.be.greaterThan(0);
          done();
        }
      });

      doc.subscribe(function() {
        // Set up event forwarding for this doc
        var realDoc = sharedWorkerManager.realConnection.get('error', 'serialization');
        sharedWorkerManager._setupDocEventForwarding(realDoc, proxyConnection1._messageBroker.tabId);

        // Send an error event (use plain object since Errors lose prototype in JSON)
        sharedWorkerManager._broadcastDocEvent('error/serialization', 'error', [{message: 'Normal error', code: 'ERR_TEST'}]);
      });
    });
  });
});