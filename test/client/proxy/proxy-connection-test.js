var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var MessageBroker = require('../../../lib/client/proxy/message-broker');

describe('ProxyConnection', function() {
  var connection;
  var originalBroadcastChannel;
  var MockBroadcastChannel;
  
  beforeEach(function() {
    // Mock BroadcastChannel for testing
    originalBroadcastChannel = global.BroadcastChannel;
    
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      this._messages = [];
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      this._messages.push(message);
      // Don't auto-respond in most tests
    };
    
    MockBroadcastChannel.prototype.close = function() {
      // Mock close
    };
    
    global.BroadcastChannel = MockBroadcastChannel;
  });
  
  afterEach(function() {
    if (connection) {
      connection.close();
      connection = null;
    }
    
    global.BroadcastChannel = originalBroadcastChannel;
  });
  
  describe('Initialization', function() {
    it('should initialize with default properties', function() {
      connection = new ProxyConnection();
      
      expect(connection.id).to.be.a('string');
      expect(connection.id).to.include('proxy_');
      expect(connection.state).to.equal('connecting');
      expect(connection.canSend).to.be.false;
      expect(connection.collections).to.be.an('object');
      expect(connection._messageBroker).to.be.an('instanceof', MessageBroker);
    });
    
    it('should initialize with custom options', function() {
      connection = new ProxyConnection({
        channelName: 'custom-channel',
        debug: true
      });
      
      expect(connection._messageBroker.channelName).to.equal('custom-channel');
      expect(connection._messageBroker.debug).to.be.true;
    });
    
    it('should send tab registration message on initialization', function() {
      connection = new ProxyConnection();
      
      // Check that initialization sends a tab.register message
      var channel = connection._messageBroker._channel;
      var registerMessage = channel._messages.find(function(msg) {
        return msg.type === 'tab.register';
      });
      
      expect(registerMessage).to.exist;
      expect(registerMessage.tabId).to.equal(connection._messageBroker.tabId);
    });
  });
  
  describe('Document Management', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should create and cache documents', function() {
      var doc1 = connection.get('posts', 'doc1');
      var doc2 = connection.get('posts', 'doc2');
      var doc3 = connection.get('users', 'user1');
      
      expect(doc1).to.exist;
      expect(doc1.collection).to.equal('posts');
      expect(doc1.id).to.equal('doc1');
      expect(doc1.connection).to.equal(connection);
      
      // Check caching
      expect(connection.getExisting('posts', 'doc1')).to.equal(doc1);
      expect(connection.getExisting('posts', 'doc2')).to.equal(doc2);
      expect(connection.getExisting('users', 'user1')).to.equal(doc3);
      
      // Check cache structure
      expect(connection.collections.posts).to.exist;
      expect(connection.collections.users).to.exist;
      expect(connection.collections.posts.doc1).to.equal(doc1);
      expect(connection.collections.posts.doc2).to.equal(doc2);
      expect(connection.collections.users.user1).to.equal(doc3);
    });
    
    it('should return existing document from cache', function() {
      var doc1 = connection.get('posts', 'doc1');
      var doc1Again = connection.get('posts', 'doc1');
      
      expect(doc1).to.equal(doc1Again); // Same object reference
    });
    
    it('should remove documents from cache', function() {
      var doc = connection.get('posts', 'doc1');
      
      expect(connection.getExisting('posts', 'doc1')).to.equal(doc);
      
      connection._removeDocFromCache(doc);
      
      expect(connection.getExisting('posts', 'doc1')).to.be.undefined;
      expect(connection.collections.posts).to.be.undefined; // Collection removed when empty
    });
  });
  
  describe('Bulk Operations', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should validate getBulk input', function(done) {
      connection.getBulk('posts', 'not-an-array', function(error, docs) {
        expect(error).to.exist;
        expect(error.message).to.equal('ids must be an array');
        done();
      });
    });
    
    it('should handle empty ids array', function(done) {
      connection.getBulk('posts', [], function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.be.an('array');
        expect(docs).to.have.length(0);
        done();
      });
    });
    
    it('should return cached documents immediately', function(done) {
      // Pre-populate cache
      var doc1 = connection.get('posts', 'doc1');
      var doc2 = connection.get('posts', 'doc2');
      
      connection.getBulk('posts', ['doc1', 'doc2'], function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.have.length(2);
        expect(docs[0]).to.equal(doc1);
        expect(docs[1]).to.equal(doc2);
        
        // Should not have sent any messages to SharedWorker since all were cached
        var channel = connection._messageBroker._channel;
        var bulkMessage = channel._messages.find(function(msg) {
          return msg.type === 'connection.getBulk';
        });
        expect(bulkMessage).to.not.exist;
        
        done();
      });
    });
    
    it('should create proxy docs for uncached documents', function(done) {
      connection.getBulk('posts', ['doc1', 'doc2'], function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.have.length(2);
        expect(docs[0].id).to.equal('doc1');
        expect(docs[1].id).to.equal('doc2');
        
        // Documents should be in cache now
        expect(connection.getExisting('posts', 'doc1')).to.equal(docs[0]);
        expect(connection.getExisting('posts', 'doc2')).to.equal(docs[1]);
        
        done();
      });
      
      // Simulate response from SharedWorker
      setTimeout(function() {
        var callback = connection._messageBroker._callbacks[Object.keys(connection._messageBroker._callbacks)[0]];
        if (callback) {
          callback.fn(null, [
            { id: 'doc1', data: { title: 'Doc 1' }, version: 1 },
            { id: 'doc2', data: { title: 'Doc 2' }, version: 1 }
          ]);
        }
      }, 10);
    });
    
    it('should handle mixed cached and uncached documents', function(done) {
      // Pre-populate cache with doc1
      var doc1 = connection.get('posts', 'doc1');
      
      connection.getBulk('posts', ['doc1', 'doc2', 'doc3'], function(error, docs) {
        expect(error).to.be.null;
        expect(docs).to.have.length(3);
        expect(docs[0]).to.equal(doc1); // From cache
        expect(docs[1].id).to.equal('doc2'); // Created new
        expect(docs[2].id).to.equal('doc3'); // Created new
        
        done();
      });
      
      // Simulate response for uncached documents
      setTimeout(function() {
        var callback = connection._messageBroker._callbacks[Object.keys(connection._messageBroker._callbacks)[0]];
        if (callback) {
          callback.fn(null, [
            { id: 'doc2', data: { title: 'Doc 2' }, version: 1 },
            { id: 'doc3', data: { title: 'Doc 3' }, version: 1 }
          ]);
        }
      }, 10);
    });
  });
  
  describe('Auto-Flush Control', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should send setAutoFlush message', function() {
      connection.setAutoFlush(false);
      
      var channel = connection._messageBroker._channel;
      var message = channel._messages.find(function(msg) {
        return msg.type === 'connection.setAutoFlush';
      });
      
      expect(message).to.exist;
      expect(message.enabled).to.be.false;
    });
    
    it('should return default for isAutoFlush', function() {
      // Since this is a proxy, isAutoFlush returns a default value
      // Real implementation would sync with SharedWorker
      var result = connection.isAutoFlush();
      expect(result).to.be.true;
    });
  });
  
  describe('Document Writing', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should send putDoc message', function(done) {
      var doc = connection.get('posts', 'doc1');
      
      connection.putDoc(doc, function(error) {
        // Callback handling would be tested with full integration
        done();
      });
      
      var channel = connection._messageBroker._channel;
      var message = channel._messages.find(function(msg) {
        return msg.type === 'connection.putDoc';
      });
      
      expect(message).to.exist;
      expect(message.collection).to.equal('posts');
      expect(message.id).to.equal('doc1');
    });
    
    it('should send putDocs message', function(done) {
      var doc1 = connection.get('posts', 'doc1');
      var doc2 = connection.get('posts', 'doc2');
      
      connection.putDocs([doc1, doc2], function(error) {
        done();
      });
      
      var channel = connection._messageBroker._channel;
      var message = channel._messages.find(function(msg) {
        return msg.type === 'connection.putDocs';
      });
      
      expect(message).to.exist;
      expect(message.docs).to.have.length(2);
      expect(message.docs[0].collection).to.equal('posts');
      expect(message.docs[0].id).to.equal('doc1');
    });
    
    it('should send flushWrites message', function() {
      connection.flushWrites();
      
      var channel = connection._messageBroker._channel;
      var message = channel._messages.find(function(msg) {
        return msg.type === 'connection.flushWrites';
      });
      
      expect(message).to.exist;
    });
  });
  
  describe('Event Handling', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should handle connection state changes', function(done) {
      connection.on('state', function(state, reason) {
        expect(state).to.equal('connected');
        expect(reason).to.equal('WebSocket ready');
        expect(connection.state).to.equal('connected');
        expect(connection.canSend).to.be.true;
        done();
      });
      
      // Simulate connection event from SharedWorker
      connection._handleConnectionEvent({
        event: 'state',
        args: ['connected', 'WebSocket ready']
      });
    });
    
    it('should forward doc events to appropriate documents', function(done) {
      var doc = connection.get('posts', 'doc1');
      
      doc.on('op', function(op, source) {
        expect(op).to.deep.equal({ p: [0], si: 'hello' });
        expect(source).to.be.true;
        done();
      });
      
      // Simulate doc event from SharedWorker
      connection._handleDocEvent({
        collection: 'posts',
        id: 'doc1',
        event: 'op',
        args: [{ p: [0], si: 'hello' }, true]
      });
    });
    
    it('should ignore events for non-existent documents', function() {
      // This should not throw an error
      connection._handleDocEvent({
        collection: 'posts',
        id: 'nonexistent',
        event: 'op',
        args: [{ p: [0], si: 'hello' }]
      });
    });
  });
  
  describe('Statistics and Debugging', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should provide connection statistics', function() {
      // Add some documents to cache
      connection.get('posts', 'doc1');
      connection.get('posts', 'doc2');
      connection.get('users', 'user1');
      
      var stats = connection.getStats();
      
      expect(stats.id).to.equal(connection.id);
      expect(stats.state).to.equal(connection.state);
      expect(stats.canSend).to.equal(connection.canSend);
      expect(stats.cachedDocuments).to.equal(3);
      expect(stats.messageBroker).to.be.an('object');
    });
    
    it('should provide debug information', function() {
      connection.get('posts', 'doc1');
      
      var debug = connection._debug();
      
      expect(debug.stats).to.be.an('object');
      expect(debug.collections).to.equal(connection.collections);
    });
  });
  
  describe('Cleanup', function() {
    beforeEach(function() {
      connection = new ProxyConnection();
    });
    
    it('should clean up resources on close', function(done) {
      connection.get('posts', 'doc1');
      
      expect(connection.state).to.not.equal('closed');
      expect(Object.keys(connection.collections)).to.have.length(1);
      
      connection.on('state', function(state) {
        if (state === 'closed') {
          expect(connection.canSend).to.be.false;
          expect(connection.collections).to.deep.equal({});
          done();
        }
      });
      
      connection.close();
    });
    
    it('should send unregister message on close', function() {
      connection.close();
      
      var channel = connection._messageBroker._channel;
      var message = channel._messages.find(function(msg) {
        return msg.type === 'tab.unregister';
      });
      
      expect(message).to.exist;
    });
  });
});