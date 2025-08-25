var expect = require('chai').expect;
var ConnectionFactory = require('../../../lib/client/proxy/connection-factory');
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var Connection = require('../../../lib/client/connection');

describe('ConnectionFactory', function() {
  var originalBroadcastChannel, originalSharedWorker;
  
  beforeEach(function() {
    // Save original globals
    originalBroadcastChannel = global.BroadcastChannel;
    originalSharedWorker = global.SharedWorker;
  });
  
  afterEach(function() {
    // Restore original globals
    global.BroadcastChannel = originalBroadcastChannel;
    global.SharedWorker = originalSharedWorker;
  });
  
  describe('Capability Detection', function() {
    it('should detect proxy capabilities correctly', function() {
      // Mock browser APIs
      global.BroadcastChannel = function() {};
      global.SharedWorker = function() {};
      global.window = {};
      global.navigator = { userAgent: 'Test Browser' };
      
      var capabilities = ConnectionFactory.getProxyCapabilities();
      
      expect(capabilities.hasSharedWorker).to.be.true;
      expect(capabilities.hasBroadcastChannel).to.be.true;
      expect(capabilities.canUseProxy).to.be.true;
      expect(capabilities.userAgent).to.equal('Test Browser');
    });
    
    it('should detect missing SharedWorker', function() {
      delete global.SharedWorker;
      global.BroadcastChannel = function() {};
      global.window = {};
      global.navigator = { userAgent: 'Test Browser' };
      
      var capabilities = ConnectionFactory.getProxyCapabilities();
      
      expect(capabilities.hasSharedWorker).to.be.false;
      expect(capabilities.hasBroadcastChannel).to.be.true;
      expect(capabilities.canUseProxy).to.be.false;
    });
    
    it('should detect missing BroadcastChannel', function() {
      global.SharedWorker = function() {};
      delete global.BroadcastChannel;
      global.window = {};
      global.navigator = { userAgent: 'Test Browser' };
      
      var capabilities = ConnectionFactory.getProxyCapabilities();
      
      expect(capabilities.hasSharedWorker).to.be.true;
      expect(capabilities.hasBroadcastChannel).to.be.false;
      expect(capabilities.canUseProxy).to.be.false;
    });
  });
  
  describe('Connection Creation', function() {
    beforeEach(function() {
      // Mock all required APIs
      global.BroadcastChannel = function() {
        this.onmessage = null;
        this.onerror = null;
        this.postMessage = function() {};
        this.close = function() {};
      };
      global.SharedWorker = function() {};
      global.window = {};
      global.navigator = { userAgent: 'Test Browser' };
    });
    
    it('should create ProxyConnection when capabilities exist', function() {
      var connection = ConnectionFactory.createConnection(null, {});
      
      expect(connection).to.be.instanceof(ProxyConnection);
    });
    
    it('should respect forceDirect option', function() {
      var mockBackend = {
        connect: function() {
          return new Connection();
        }
      };
      
      var connection = ConnectionFactory.createConnection(mockBackend, {
        forceDirect: true
      });
      
      expect(connection).to.be.instanceof(Connection);
      expect(connection).to.not.be.instanceof(ProxyConnection);
    });
    
    it('should respect forceProxy option', function() {
      // Remove capabilities
      delete global.SharedWorker;
      delete global.BroadcastChannel;
      
      var connection = ConnectionFactory.createConnection(null, {
        forceProxy: true
      });
      
      expect(connection).to.be.instanceof(ProxyConnection);
    });
    
    it('should respect useSharedWorker: false option', function() {
      var mockBackend = {
        connect: function() {
          return new Connection();
        }
      };
      
      var connection = ConnectionFactory.createConnection(mockBackend, {
        useSharedWorker: false
      });
      
      expect(connection).to.be.instanceof(Connection);
      expect(connection).to.not.be.instanceof(ProxyConnection);
    });
    
    it('should create direct connection when proxy not supported', function() {
      // Remove browser capabilities
      delete global.SharedWorker;
      delete global.BroadcastChannel;
      
      var mockBackend = {
        connect: function() {
          return new Connection();
        }
      };
      
      var connection = ConnectionFactory.createConnection(mockBackend, {});
      
      expect(connection).to.be.instanceof(Connection);
      expect(connection).to.not.be.instanceof(ProxyConnection);
    });
    
    it('should handle backend vs socket parameter', function() {
      var mockBackend = {
        connect: function() {
          return new Connection();
        }
      };
      
      // Test with backend
      var connection1 = ConnectionFactory.createConnection(mockBackend, {
        forceDirect: true
      });
      expect(connection1).to.be.instanceof(Connection);
      
      // Test with socket-like object (would create Connection directly)
      var mockSocket = { on: function() {}, send: function() {} };
      var connection2 = ConnectionFactory.createConnection(mockSocket, {
        forceDirect: true
      });
      expect(connection2).to.be.instanceof(Connection);
    });
  });
  
  describe('Storage Integration', function() {
    beforeEach(function() {
      global.BroadcastChannel = function() {
        this.onmessage = null;
        this.postMessage = function() {};
        this.close = function() {};
      };
      global.SharedWorker = function() {};
      global.window = {};
      global.navigator = { userAgent: 'Test Browser' };
    });
    
    it('should create connection with storage', function() {
      var mockStorage = { initialize: function() {} };
      
      var connection = ConnectionFactory.createConnectionWithStorage(
        null,
        mockStorage,
        { debug: true }
      );
      
      expect(connection).to.be.instanceof(ProxyConnection);
      // Storage would be passed through options
    });
  });
  
  describe('Utility Methods', function() {
    beforeEach(function() {
      global.BroadcastChannel = function() {
        this.postMessage = function() {};
        this.close = function() {};
      };
    });
    
    it('should identify proxy connections', function() {
      var proxyConnection = new ProxyConnection();
      var regularConnection = new Connection();
      
      expect(ConnectionFactory.isProxyConnection(proxyConnection)).to.be.true;
      expect(ConnectionFactory.isProxyConnection(regularConnection)).to.be.false;
      
      proxyConnection.close();
    });
    
    it('should provide connection statistics', function() {
      global.SharedWorker = function() {};
      global.navigator = { userAgent: 'Test Browser' };
      
      var stats = ConnectionFactory.getConnectionStats();
      
      expect(stats.capabilities).to.exist;
      expect(stats.timestamp).to.be.a('string');
      expect(stats.capabilities.canUseProxy).to.be.a('boolean');
    });
  });
  
  describe('SharedWorker Script Generation', function() {
    beforeEach(function() {
      // Mock Blob and URL for script generation
      global.Blob = function(content, options) {
        this.content = content;
        this.type = options.type;
      };
      
      global.URL = {
        createObjectURL: function(blob) {
          return 'blob:mock-url-' + Date.now();
        }
      };
    });
    
    afterEach(function() {
      delete global.Blob;
      delete global.URL;
    });
    
    it('should create SharedWorker script URL', function() {
      var scriptUrl = ConnectionFactory.createSharedWorkerScript({
        debug: true,
        channelName: 'test-channel'
      });
      
      expect(scriptUrl).to.be.a('string');
      expect(scriptUrl).to.include('blob:mock-url-');
    });
    
    it('should create script with custom options', function() {
      var scriptUrl = ConnectionFactory.createSharedWorkerScript({
        sharedbPath: '/custom/sharedb.js',
        debug: false,
        channelName: 'custom-channel'
      });
      
      expect(scriptUrl).to.be.a('string');
    });
  });
  
  describe('Convenience Methods', function() {
    beforeEach(function() {
      global.BroadcastChannel = function() {
        this.postMessage = function() {};
        this.close = function() {};
      };
      global.SharedWorker = function() {};
    });
    
    it('should provide convenience create method', function() {
      var connection = ConnectionFactory.create(null, {});
      expect(connection).to.be.instanceof(ProxyConnection);
      connection.close();
    });
    
    it('should provide convenience withStorage method', function() {
      var mockStorage = {};
      var connection = ConnectionFactory.withStorage(null, mockStorage, {});
      expect(connection).to.be.instanceof(ProxyConnection);
      connection.close();
    });
  });
});