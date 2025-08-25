/**
 * ShareDB SharedWorker Proxy System
 * 
 * This module provides transparent multi-tab support for ShareDB by using
 * a SharedWorker to host a single Connection and DurableStore, with lightweight
 * proxy objects in each tab that communicate via BroadcastChannel.
 * 
 * Key Benefits:
 * - Eliminates IndexedDB conflicts between multiple tabs
 * - Reduces network usage (single WebSocket connection)
 * - Enables real-time synchronization between tabs
 * - Transparent API - no code changes required
 */

var ConnectionFactory = require('./connection-factory');
var ProxyConnection = require('./proxy-connection');
var ProxyDoc = require('./proxy-doc');
var MessageBroker = require('./message-broker');
var SharedWorkerManager = require('./shared-worker-manager');

module.exports = {
  // Main factory for creating connections
  ConnectionFactory: ConnectionFactory,
  
  // Proxy classes
  ProxyConnection: ProxyConnection,
  ProxyDoc: ProxyDoc,
  
  // Communication layer
  MessageBroker: MessageBroker,
  
  // SharedWorker host (for use in worker scripts)
  SharedWorkerManager: SharedWorkerManager,
  
  // Convenience methods
  createConnection: ConnectionFactory.createConnection,
  createConnectionWithStorage: ConnectionFactory.createConnectionWithStorage,
  isProxyConnection: ConnectionFactory.isProxyConnection,
  getProxyCapabilities: ConnectionFactory.getProxyCapabilities,
  
  // Utility methods
  hasProxySupport: function() {
    return ConnectionFactory.getProxyCapabilities().canUseProxy;
  },
  
  /**
   * Create a connection with automatic proxy detection
   * This is the main entry point for applications
   */
  connect: function(backendOrSocket, options) {
    return ConnectionFactory.createConnection(backendOrSocket, options);
  },
  
  /**
   * Create a connection with DurableStore support
   */
  connectWithStorage: function(backendOrSocket, storage, options) {
    return ConnectionFactory.createConnectionWithStorage(backendOrSocket, storage, options);
  }
};