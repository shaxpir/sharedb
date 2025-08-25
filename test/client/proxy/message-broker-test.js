var expect = require('chai').expect;
var MessageBroker = require('../../../lib/client/proxy/message-broker');

describe('MessageBroker', function() {
  var broker;
  
  // Mock BroadcastChannel for Node.js testing
  var MockBroadcastChannel;
  var originalBroadcastChannel;
  
  beforeEach(function() {
    // Save original BroadcastChannel if it exists
    originalBroadcastChannel = global.BroadcastChannel;
    
    // Create mock BroadcastChannel
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      this._closed = false;
      
      // Store reference for cross-channel communication
      MockBroadcastChannel._instances = MockBroadcastChannel._instances || [];
      MockBroadcastChannel._instances.push(this);
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      var channel = this;
      setTimeout(function() {
        // Broadcast to all other instances with the same name
        MockBroadcastChannel._instances.forEach(function(instance) {
          if (instance !== channel && instance.name === channel.name && instance.onmessage) {
            instance.onmessage({ data: message });
          }
        });
      }, 0);
    };
    
    MockBroadcastChannel.prototype.close = function() {
      this._closed = true;
      var index = MockBroadcastChannel._instances.indexOf(this);
      if (index > -1) {
        MockBroadcastChannel._instances.splice(index, 1);
      }
    };
    
    // Reset instances
    MockBroadcastChannel._instances = [];
    
    // Set global BroadcastChannel to our mock
    global.BroadcastChannel = MockBroadcastChannel;
  });
  
  afterEach(function() {
    if (broker) {
      broker.close();
      broker = null;
    }
    
    // Clean up all mock instances
    if (MockBroadcastChannel._instances) {
      MockBroadcastChannel._instances.forEach(function(instance) {
        instance.close();
      });
      MockBroadcastChannel._instances = [];
    }
    
    // Restore original BroadcastChannel
    global.BroadcastChannel = originalBroadcastChannel;
  });
  
  describe('Initialization', function() {
    it('should initialize with default options', function() {
      broker = new MessageBroker();
      
      expect(broker.channelName).to.equal('sharedb-proxy');
      expect(broker.debug).to.be.false;
      expect(broker.tabId).to.be.a('string');
      expect(broker.tabId).to.include('tab_');
    });
    
    it('should initialize with custom options', function() {
      broker = new MessageBroker({
        channelName: 'custom-channel',
        debug: true
      });
      
      expect(broker.channelName).to.equal('custom-channel');
      expect(broker.debug).to.be.true;
    });
    
    it('should emit ready event when channel is initialized', function(done) {
      broker = new MessageBroker();
      
      broker.on('ready', function() {
        expect(broker.isReady()).to.be.true;
        done();
      });
    });
    
    it('should handle BroadcastChannel not supported', function(done) {
      delete global.BroadcastChannel;
      
      broker = new MessageBroker();
      
      broker.on('error', function(error) {
        expect(error.message).to.include('BroadcastChannel not supported');
        done();
      });
    });
  });
  
  describe('Message Sending', function() {
    beforeEach(function(done) {
      broker = new MessageBroker({ debug: true });
      broker.on('ready', done);
    });
    
    it('should send message without callback', function() {
      var message = { type: 'test', data: 'hello' };
      
      expect(function() {
        broker.send(message);
      }).to.not.throw();
      
      expect(message.tabId).to.equal(broker.tabId);
      expect(message.timestamp).to.be.a('number');
    });
    
    it('should send message with callback', function(done) {
      var message = { type: 'test', data: 'hello' };
      
      broker.send(message, function(error, result) {
        expect(error).to.be.null;
        expect(result).to.equal('response');
        done();
      });
      
      expect(message.callbackId).to.be.a('string');
      
      // Simulate callback response
      setTimeout(function() {
        broker._handleMessage({
          type: 'callback',
          callbackId: message.callbackId,
          error: null,
          result: 'response'
        });
      }, 10);
    });
    
    it('should queue messages when not ready', function() {
      var notReadyBroker = new MessageBroker();
      notReadyBroker._isReady = false;
      
      notReadyBroker.send({ type: 'queued' });
      
      expect(notReadyBroker._messageQueue).to.have.length(1);
      expect(notReadyBroker._messageQueue[0].type).to.equal('queued');
      
      notReadyBroker.close();
    });
    
    it('should flush queued messages when ready', function(done) {
      var notReadyBroker = new MessageBroker();
      notReadyBroker._isReady = false;
      
      // Queue some messages
      notReadyBroker.send({ type: 'queued1' });
      notReadyBroker.send({ type: 'queued2' });
      
      expect(notReadyBroker._messageQueue).to.have.length(2);
      
      // Manually trigger ready state
      notReadyBroker._isReady = true;
      notReadyBroker._flushMessageQueue();
      
      expect(notReadyBroker._messageQueue).to.have.length(0);
      
      notReadyBroker.close();
      done();
    });
  });
  
  describe('Message Receiving', function() {
    var broker2;
    
    beforeEach(function(done) {
      broker = new MessageBroker({ channelName: 'test-channel' });
      broker2 = new MessageBroker({ channelName: 'test-channel' });
      
      var readyCount = 0;
      function checkReady() {
        readyCount++;
        if (readyCount === 2) done();
      }
      
      broker.on('ready', checkReady);
      broker2.on('ready', checkReady);
    });
    
    afterEach(function() {
      if (broker2) {
        broker2.close();
        broker2 = null;
      }
    });
    
    it('should receive and handle callback messages', function(done) {
      var callbackId = 'test-callback-123';
      var callbackCalled = false;
      
      broker._callbacks[callbackId] = {
        fn: function(error, result) {
          expect(error).to.be.null;
          expect(result).to.equal('test-result');
          callbackCalled = true;
        },
        timestamp: Date.now()
      };
      
      // Send callback message from broker2
      setTimeout(function() {
        broker2._channel.postMessage({
          type: 'callback',
          callbackId: callbackId,
          error: null,
          result: 'test-result',
          tabId: broker2.tabId
        });
        
        setTimeout(function() {
          expect(callbackCalled).to.be.true;
          expect(broker._callbacks[callbackId]).to.be.undefined;
          done();
        }, 10);
      }, 10);
    });
    
    it('should receive and emit doc events', function(done) {
      broker.on('doc.event', function(eventData) {
        expect(eventData.collection).to.equal('posts');
        expect(eventData.id).to.equal('doc123');
        expect(eventData.event).to.equal('op');
        expect(eventData.args).to.deep.equal([{ p: [0], si: 'hello' }]);
        done();
      });
      
      setTimeout(function() {
        broker2._channel.postMessage({
          type: 'doc.event',
          collection: 'posts',
          id: 'doc123',
          event: 'op',
          args: [{ p: [0], si: 'hello' }],
          tabId: broker2.tabId
        });
      }, 10);
    });
    
    it('should receive and emit connection events', function(done) {
      broker.on('connection.event', function(eventData) {
        expect(eventData.event).to.equal('state');
        expect(eventData.args).to.deep.equal(['connected', 'WebSocket connected']);
        done();
      });
      
      setTimeout(function() {
        broker2._channel.postMessage({
          type: 'connection.event',
          event: 'state',
          args: ['connected', 'WebSocket connected'],
          tabId: broker2.tabId
        });
      }, 10);
    });
    
    it('should ignore messages from same tab', function(done) {
      var messageReceived = false;
      
      broker.on('message', function() {
        messageReceived = true;
      });
      
      // Send message from same broker (same tabId)
      broker._channel.postMessage({
        type: 'unknown',
        tabId: broker.tabId
      });
      
      setTimeout(function() {
        expect(messageReceived).to.be.false;
        done();
      }, 20);
    });
  });
  
  describe('Callback Management', function() {
    beforeEach(function(done) {
      broker = new MessageBroker();
      broker.on('ready', done);
    });
    
    it('should register and execute callbacks', function(done) {
      var callback = function(error, result) {
        expect(error).to.be.null;
        expect(result).to.equal('success');
        done();
      };
      
      var callbackId = broker._registerCallback(callback);
      
      expect(callbackId).to.be.a('string');
      expect(broker._callbacks[callbackId]).to.exist;
      
      broker._executeCallback(callbackId, null, 'success');
    });
    
    it('should clean up callbacks after execution', function() {
      var callback = function() {};
      var callbackId = broker._registerCallback(callback);
      
      expect(broker._callbacks[callbackId]).to.exist;
      
      broker._executeCallback(callbackId, null, 'result');
      
      expect(broker._callbacks[callbackId]).to.be.undefined;
    });
    
    it('should clean up expired callbacks', function() {
      var callback = function() {};
      var callbackId = broker._registerCallback(callback);
      
      // Make callback appear old
      broker._callbacks[callbackId].timestamp = Date.now() - 60000; // 1 minute ago
      
      broker._cleanupCallbacks(30000); // 30 second max age
      
      expect(broker._callbacks[callbackId]).to.be.undefined;
    });
    
    it('should handle callback errors gracefully', function() {
      var callback = function() {
        throw new Error('Callback error');
      };
      var callbackId = broker._registerCallback(callback);
      
      var errorEmitted = false;
      broker.on('error', function(error) {
        expect(error.message).to.equal('Callback error');
        errorEmitted = true;
      });
      
      expect(function() {
        broker._executeCallback(callbackId, null, 'result');
      }).to.not.throw();
      
      expect(errorEmitted).to.be.true;
    });
  });
  
  describe('Statistics and State', function() {
    beforeEach(function(done) {
      broker = new MessageBroker({ debug: true });
      broker.on('ready', done);
    });
    
    it('should provide accurate statistics', function() {
      var stats = broker.getStats();
      
      expect(stats.tabId).to.equal(broker.tabId);
      expect(stats.isReady).to.be.true;
      expect(stats.queuedMessages).to.equal(0);
      expect(stats.pendingCallbacks).to.equal(0);
      expect(stats.channelName).to.equal('sharedb-proxy');
    });
    
    it('should track queued messages in stats', function() {
      broker._isReady = false;
      broker.send({ type: 'queued' });
      
      var stats = broker.getStats();
      expect(stats.queuedMessages).to.equal(1);
    });
    
    it('should track pending callbacks in stats', function() {
      broker._registerCallback(function() {});
      
      var stats = broker.getStats();
      expect(stats.pendingCallbacks).to.equal(1);
    });
  });
  
  describe('Cleanup and Resource Management', function() {
    beforeEach(function(done) {
      broker = new MessageBroker();
      broker.on('ready', done);
    });
    
    it('should clean up resources on close', function() {
      var callback = function() {};
      broker._registerCallback(callback);
      broker.send({ type: 'queued' });
      
      expect(Object.keys(broker._callbacks)).to.have.length(1);
      expect(broker._messageQueue).to.have.length(0); // Messages sent immediately when ready
      
      var closedEmitted = false;
      broker.on('close', function() {
        closedEmitted = true;
      });
      
      broker.close();
      
      expect(broker._isReady).to.be.false;
      expect(Object.keys(broker._callbacks)).to.have.length(0);
      expect(broker._messageQueue).to.have.length(0);
      expect(broker._channel).to.be.null;
      expect(closedEmitted).to.be.true;
    });
    
    it('should start and stop cleanup timer', function() {
      broker.startCleanupTimer(100);
      expect(broker._cleanupTimer).to.exist;
      
      broker.stopCleanupTimer();
      expect(broker._cleanupTimer).to.be.null;
    });
  });
});