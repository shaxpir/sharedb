var Connection = require('../connection');
var ProxyConnection = require('./proxy-connection');

/**
 * ConnectionFactory provides transparent creation of either regular Connection
 * or ProxyConnection based on browser capabilities and configuration.
 */
var ConnectionFactory = {
  
  /**
   * Create a connection, automatically choosing between proxy and direct connection
   * 
   * @param {Backend|Socket} backendOrSocket - Backend instance or WebSocket-like object
   * @param {Object} options - Connection options
   * @param {boolean} options.useSharedWorker - Whether to use SharedWorker proxy (default: auto-detect)
   * @param {boolean} options.forceProxy - Force use of proxy even if not recommended
   * @param {boolean} options.forceDirect - Force use of direct connection
   * @param {string} options.channelName - BroadcastChannel name for proxy communication
   * @param {boolean} options.debug - Enable debug logging
   * @returns {Connection|ProxyConnection} Connection instance
   */
  createConnection: function(backendOrSocket, options) {
    options = options || {};
    
    // Determine whether to use proxy connection
    var shouldUseProxy = this._shouldUseProxy(options);
    
    if (shouldUseProxy) {
      // Create proxy connection
      var proxyOptions = {
        channelName: options.channelName,
        debug: options.debug,
        storage: options.storage,
        durableStoreOptions: options.durableStoreOptions
      };
      
      var proxyConnection = new ProxyConnection(proxyOptions);
      
      // Initialize SharedWorker if needed
      this._ensureSharedWorkerInitialized(proxyOptions);
      
      return proxyConnection;
    } else {
      // Create regular connection
      if (typeof backendOrSocket.connect === 'function') {
        // Backend instance
        return backendOrSocket.connect();
      } else {
        // WebSocket-like object
        return new Connection(backendOrSocket);
      }
    }
  },
  
  /**
   * Determine whether to use proxy connection based on capabilities and options
   */
  _shouldUseProxy: function(options) {
    // Force direct connection
    if (options.forceDirect) {
      return false;
    }
    
    // Force proxy connection
    if (options.forceProxy) {
      return true;
    }
    
    // Check browser capabilities
    if (!this._hasProxyCapabilities()) {
      return false;
    }
    
    // Default behavior: use proxy if capabilities exist and not explicitly disabled
    if (options.useSharedWorker === false) {
      return false;
    }
    
    // Use proxy by default when capabilities are available
    return true;
  },
  
  /**
   * Check if the browser supports proxy functionality
   */
  _hasProxyCapabilities: function() {
    // Check for SharedWorker support
    if (typeof SharedWorker === 'undefined') {
      return false;
    }
    
    // Check for BroadcastChannel support
    if (typeof BroadcastChannel === 'undefined') {
      return false;
    }
    
    // Check for basic browser APIs we need
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }
    
    return true;
  },
  
  /**
   * Get information about proxy capabilities
   */
  getProxyCapabilities: function() {
    return {
      hasSharedWorker: typeof SharedWorker !== 'undefined',
      hasBroadcastChannel: typeof BroadcastChannel !== 'undefined',
      hasIndexedDB: typeof indexedDB !== 'undefined',
      canUseProxy: this._hasProxyCapabilities(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    };
  },
  
  /**
   * Ensure SharedWorker is initialized (create if doesn't exist)
   */
  _ensureSharedWorkerInitialized: function(options) {
    // This would initialize the SharedWorker if it hasn't been created yet
    // For now, we'll just ensure the SharedWorker script exists
    
    if (typeof SharedWorker === 'undefined') {
      return;
    }
    
    // Create or reference the SharedWorker
    // This is where we'd load the SharedWorker script
    var sharedWorkerPath = options.sharedWorkerPath || '/sharedb-shared-worker.js';
    
    try {
      // We'll create the worker but not store a reference since communication
      // happens via BroadcastChannel, not direct MessagePort
      new SharedWorker(sharedWorkerPath, 'sharedb-proxy-worker');
    } catch (error) {
      console.warn('Failed to create SharedWorker:', error);
      // This is non-fatal - the proxy will still work if the worker is already running
    }
  },
  
  /**
   * Create connection with automatic DurableStore setup
   */
  createConnectionWithStorage: function(backendOrSocket, storage, options) {
    options = options || {};
    options.storage = storage;
    
    return this.createConnection(backendOrSocket, options);
  },
  
  /**
   * Utility method to check if a given connection is a proxy
   */
  isProxyConnection: function(connection) {
    return connection instanceof ProxyConnection;
  },
  
  /**
   * Get statistics about all connections (useful for debugging)
   */
  getConnectionStats: function() {
    // This would require keeping track of created connections
    // For now, return basic capability info
    return {
      capabilities: this.getProxyCapabilities(),
      timestamp: new Date().toISOString()
    };
  },
  
  /**
   * Create a SharedWorker script URL from the current ShareDB modules
   * This is a utility for applications that need to generate the worker script
   */
  createSharedWorkerScript: function(options) {
    options = options || {};
    
    // This would generate or return a URL to a SharedWorker script
    // that includes the SharedWorkerManager and dependencies
    
    var scriptContent = [
      '// ShareDB SharedWorker Script',
      '// This script hosts the real ShareDB connection in a SharedWorker',
      '',
      'importScripts("' + (options.sharedbPath || '/sharedb.js') + '");',
      '',
      '// Initialize the SharedWorkerManager',
      'var SharedWorkerManager = sharedb.SharedWorkerManager;',
      'var manager = new SharedWorkerManager({',
      '  debug: ' + (options.debug || false) + ',',
      '  channelName: "' + (options.channelName || 'sharedb-proxy') + '"',
      '});',
      '',
      '// The manager will handle all communication with tabs'
    ].join('\n');
    
    // Return as data URL for inline worker
    var blob = new Blob([scriptContent], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }
};

// Convenience methods for common use cases
ConnectionFactory.create = ConnectionFactory.createConnection;
ConnectionFactory.withStorage = ConnectionFactory.createConnectionWithStorage;

module.exports = ConnectionFactory;