// This file runs in the SharedWorker context and hosts the real ShareDB connection

var Connection = require('../connection');
var DurableStore = require('../durable-store');

/**
 * SharedWorkerManager hosts the real ShareDB Connection and DurableStore,
 * handling all proxy requests from tabs via BroadcastChannel messages.
 */
function SharedWorkerManager(options) {
  options = options || {};
  
  this.debug = options.debug || false;
  this.channelName = options.channelName || 'sharedb-proxy';
  
  // Real ShareDB objects
  this.realConnection = null;
  this.durableStore = null;
  
  // Tab management
  this.activeTabs = new Set();
  this.tabSubscriptions = {}; // tabId → Set of doc keys
  this.docSubscriptions = {}; // docKey → Set of tabIds
  
  // Message handling
  this.messageHandlers = {};
  this._setupMessageHandlers();
  
  // BroadcastChannel for communication with tabs
  this._channel = null;
  this._initializeChannel();
  
  // Initialize real connection
  this._initializeRealConnection(options);
  
  this._log('SharedWorkerManager initialized');
}

/**
 * Initialize BroadcastChannel for communication with tabs
 */
SharedWorkerManager.prototype._initializeChannel = function() {
  var manager = this;
  
  if (typeof BroadcastChannel === 'undefined') {
    this._logError('BroadcastChannel not supported in SharedWorker environment');
    return;
  }
  
  try {
    this._channel = new BroadcastChannel(this.channelName);
    
    this._channel.onmessage = function(event) {
      manager._handleMessage(event.data);
    };
    
    this._channel.onerror = function(error) {
      manager._logError('BroadcastChannel error:', error);
    };
    
    this._log('BroadcastChannel initialized');
  } catch (error) {
    this._logError('Failed to initialize BroadcastChannel:', error);
  }
};

/**
 * Initialize the real ShareDB connection and DurableStore
 */
SharedWorkerManager.prototype._initializeRealConnection = function(options) {
  var manager = this;
  
  // Create the real connection (this would normally connect to a backend)
  // For now we'll create a mock connection that can be used for testing
  this.realConnection = new Connection();
  
  // Set up DurableStore if storage is provided
  if (options.storage) {
    this.durableStore = new DurableStore(options.storage, options.durableStoreOptions || {});
    this.realConnection.durableStore = this.durableStore;
    
    this.durableStore.initialize(function(error) {
      if (error) {
        manager._logError('Failed to initialize DurableStore:', error);
      } else {
        manager._log('DurableStore initialized');
      }
    });
  }
  
  // Forward connection events to all tabs
  this.realConnection.on('state', function(state, reason) {
    manager._broadcastConnectionEvent('state', [state, reason]);
  });
  
  this.realConnection.on('error', function(error) {
    manager._broadcastConnectionEvent('error', [error]);
  });
};

/**
 * Set up message handlers for different message types
 */
SharedWorkerManager.prototype._setupMessageHandlers = function() {
  this.messageHandlers = {
    'connection.get': this._handleConnectionGet.bind(this),
    'connection.getBulk': this._handleConnectionGetBulk.bind(this),
    'connection.setAutoFlush': this._handleConnectionSetAutoFlush.bind(this),
    'connection.isAutoFlush': this._handleConnectionIsAutoFlush.bind(this),
    'connection.putDoc': this._handleConnectionPutDoc.bind(this),
    'connection.putDocs': this._handleConnectionPutDocs.bind(this),
    'connection.putDocsBulk': this._handleConnectionPutDocsBulk.bind(this),
    'connection.flushWrites': this._handleConnectionFlushWrites.bind(this),
    'connection.getWriteQueueSize': this._handleConnectionGetWriteQueueSize.bind(this),
    'connection.hasPendingWrites': this._handleConnectionHasPendingWrites.bind(this),
    'doc.subscribe': this._handleDocSubscribe.bind(this),
    'doc.unsubscribe': this._handleDocUnsubscribe.bind(this),
    'doc.fetch': this._handleDocFetch.bind(this),
    'doc.create': this._handleDocCreate.bind(this),
    'doc.submitOp': this._handleDocSubmitOp.bind(this),
    'doc.del': this._handleDocDel.bind(this),
    'tab.register': this._handleTabRegister.bind(this),
    'tab.unregister': this._handleTabUnregister.bind(this)
  };
};

/**
 * Handle incoming messages from tabs
 */
SharedWorkerManager.prototype._handleMessage = function(message) {
  if (!message || !message.type) {
    this._logError('Received invalid message:', message);
    return;
  }
  
  var tabId = message.tabId;
  if (tabId) {
    this.activeTabs.add(tabId);
  }
  
  this._log('Received message:', message.type, 'from tab:', tabId);
  
  var handler = this.messageHandlers[message.type];
  if (handler) {
    try {
      handler(message);
    } catch (error) {
      this._logError('Error handling message:', message.type, error);
      this._sendCallback(message.callbackId, error, null, tabId);
    }
  } else {
    this._logError('Unknown message type:', message.type);
    this._sendCallback(message.callbackId, new Error('Unknown message type: ' + message.type), null, tabId);
  }
};

/**
 * Handle connection.get requests
 */
SharedWorkerManager.prototype._handleConnectionGet = function(message) {
  var collection = message.collection;
  var id = message.id;
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  if (!collection || !id) {
    return this._sendCallback(callbackId, new Error('Missing collection or id'), null, tabId);
  }
  
  // Get the document from real connection
  var doc = this.realConnection.get(collection, id);
  
  // Set up event forwarding for this document to this tab
  this._setupDocEventForwarding(doc, tabId);
  
  // Return serialized document info
  var docData = this._serializeDoc(doc);
  this._sendCallback(callbackId, null, docData, tabId);
};

/**
 * Handle connection.getBulk requests
 */
SharedWorkerManager.prototype._handleConnectionGetBulk = function(message) {
  var collection = message.collection;
  var ids = message.ids;
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  if (!collection || !Array.isArray(ids)) {
    return this._sendCallback(callbackId, new Error('Missing collection or invalid ids'), null, tabId);
  }
  
  var manager = this;
  
  // Use the real connection's getBulk method
  this.realConnection.getBulk(collection, ids, function(error, docs) {
    if (error) {
      return manager._sendCallback(callbackId, error, null, tabId);
    }
    
    // Set up event forwarding for all documents
    var docDatas = [];
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      manager._setupDocEventForwarding(doc, tabId);
      docDatas.push(manager._serializeDoc(doc));
    }
    
    manager._sendCallback(callbackId, null, docDatas, tabId);
  });
};

/**
 * Handle auto-flush control methods
 */
SharedWorkerManager.prototype._handleConnectionSetAutoFlush = function(message) {
  var enabled = message.enabled;
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  this.realConnection.setAutoFlush(enabled);
  this._sendCallback(callbackId, null, undefined, tabId);
};

SharedWorkerManager.prototype._handleConnectionIsAutoFlush = function(message) {
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  var isAutoFlush = this.realConnection.isAutoFlush();
  this._sendCallback(callbackId, null, isAutoFlush, tabId);
};

/**
 * Handle document writing methods
 */
SharedWorkerManager.prototype._handleConnectionPutDoc = function(message) {
  // This would need the actual doc object, which is tricky to serialize
  // For now, we'll implement this as a method that works with doc references
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  // TODO: Implement proper doc serialization and reconstruction
  this._sendCallback(callbackId, new Error('putDoc not yet implemented in proxy'), null, tabId);
};

/**
 * Handle document subscription
 */
SharedWorkerManager.prototype._handleDocSubscribe = function(message) {
  var collection = message.collection;
  var id = message.id;
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  var doc = this.realConnection.get(collection, id);
  var manager = this;
  
  doc.subscribe(function(error) {
    if (error) {
      return manager._sendCallback(callbackId, error, null, tabId);
    }
    
    // Set up event forwarding
    manager._setupDocEventForwarding(doc, tabId);
    
    // Return document data after subscription
    var docData = manager._serializeDoc(doc);
    manager._sendCallback(callbackId, null, docData, tabId);
  });
};

/**
 * Handle document operations
 */
SharedWorkerManager.prototype._handleDocSubmitOp = function(message) {
  var collection = message.collection;
  var id = message.id;
  var op = message.op;
  var source = message.source;
  var tabId = message.tabId;
  var callbackId = message.callbackId;
  
  var doc = this.realConnection.get(collection, id);
  var manager = this;
  
  doc.submitOp(op, source, function(error) {
    manager._sendCallback(callbackId, error, null, tabId);
  });
};

/**
 * Set up event forwarding from a document to interested tabs
 */
SharedWorkerManager.prototype._setupDocEventForwarding = function(doc, tabId) {
  var docKey = doc.collection + '/' + doc.id;
  
  // Track this subscription
  if (!this.tabSubscriptions[tabId]) {
    this.tabSubscriptions[tabId] = new Set();
  }
  this.tabSubscriptions[tabId].add(docKey);
  
  if (!this.docSubscriptions[docKey]) {
    this.docSubscriptions[docKey] = new Set();
    
    // Set up event listeners on first subscription to this document
    var manager = this;
    
    doc.on('load', function() {
      manager._broadcastDocEvent(docKey, 'load', []);
    });
    
    doc.on('create', function(source) {
      manager._broadcastDocEvent(docKey, 'create', [source]);
    });
    
    doc.on('op', function(op, source) {
      manager._broadcastDocEvent(docKey, 'op', [op, source]);
    });
    
    doc.on('del', function(data, source) {
      manager._broadcastDocEvent(docKey, 'del', [data, source]);
    });
    
    doc.on('error', function(error) {
      manager._broadcastDocEvent(docKey, 'error', [error]);
    });
  }
  
  this.docSubscriptions[docKey].add(tabId);
};

/**
 * Broadcast a document event to all subscribed tabs
 */
SharedWorkerManager.prototype._broadcastDocEvent = function(docKey, event, args) {
  var subscribedTabs = this.docSubscriptions[docKey];
  if (!subscribedTabs) {
    return;
  }
  
  var parts = docKey.split('/');
  var collection = parts[0];
  var id = parts.slice(1).join('/');
  
  var message = {
    type: 'doc.event',
    collection: collection,
    id: id,
    event: event,
    args: args,
    timestamp: Date.now()
  };
  
  this._log('Broadcasting doc event:', event, 'for', docKey, 'to', subscribedTabs.size, 'tabs');
  this._broadcast(message);
};

/**
 * Broadcast a connection event to all tabs
 */
SharedWorkerManager.prototype._broadcastConnectionEvent = function(event, args) {
  var message = {
    type: 'connection.event',
    event: event,
    args: args,
    timestamp: Date.now()
  };
  
  this._log('Broadcasting connection event:', event, 'to all tabs');
  this._broadcast(message);
};

/**
 * Send a message to all tabs via BroadcastChannel
 */
SharedWorkerManager.prototype._broadcast = function(message) {
  if (!this._channel) {
    this._logError('Cannot broadcast - channel not initialized');
    return;
  }
  
  try {
    this._channel.postMessage(message);
  } catch (error) {
    this._logError('Failed to broadcast message:', error);
  }
};

/**
 * Send a callback response to a specific tab
 */
SharedWorkerManager.prototype._sendCallback = function(callbackId, error, result, tabId) {
  if (!callbackId) {
    return; // No callback expected
  }
  
  var message = {
    type: 'callback',
    callbackId: callbackId,
    error: error ? this._serializeError(error) : null,
    result: result,
    tabId: tabId,
    timestamp: Date.now()
  };
  
  this._broadcast(message);
};

/**
 * Serialize a document for transmission to tabs
 */
SharedWorkerManager.prototype._serializeDoc = function(doc) {
  return {
    collection: doc.collection,
    id: doc.id,
    version: doc.version,
    type: doc.type ? doc.type.name || doc.type : null,
    data: doc.data,
    subscribed: !!doc.subscribed,
    hasPendingOps: doc.hasPendingOps(),
    inflightOp: doc.inflightOp
  };
};

/**
 * Serialize an error for transmission
 */
SharedWorkerManager.prototype._serializeError = function(error) {
  if (!error) return null;
  
  return {
    message: error.message,
    code: error.code,
    stack: error.stack
  };
};

/**
 * Clean up subscriptions for a disconnected tab
 */
SharedWorkerManager.prototype._cleanupTab = function(tabId) {
  this._log('Cleaning up subscriptions for tab:', tabId);
  
  var tabSubs = this.tabSubscriptions[tabId];
  if (tabSubs) {
    tabSubs.forEach(function(docKey) {
      var docSubs = this.docSubscriptions[docKey];
      if (docSubs) {
        docSubs.delete(tabId);
        if (docSubs.size === 0) {
          delete this.docSubscriptions[docKey];
          // Could unsubscribe from doc here to free memory
        }
      }
    }.bind(this));
    
    delete this.tabSubscriptions[tabId];
  }
  
  this.activeTabs.delete(tabId);
};

/**
 * Get statistics about the SharedWorkerManager
 */
SharedWorkerManager.prototype.getStats = function() {
  return {
    activeTabs: this.activeTabs.size,
    documentSubscriptions: Object.keys(this.docSubscriptions).length,
    connectionState: this.realConnection ? this.realConnection.state : 'disconnected',
    durableStoreReady: this.durableStore ? true : false
  };
};

/**
 * Logging helpers
 */
SharedWorkerManager.prototype._log = function() {
  if (this.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[SharedWorkerManager]');
    console.log.apply(console, args);
  }
};

SharedWorkerManager.prototype._logError = function() {
  if (this.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[SharedWorkerManager ERROR]');
    console.error.apply(console, args);
  }
};

// Export the SharedWorkerManager for use in actual SharedWorker files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SharedWorkerManager;
}

// If we're running in a SharedWorker context, initialize automatically
if (typeof self !== 'undefined' && typeof importScripts !== 'undefined') {
  // We're in a SharedWorker - initialize the manager
  var manager = new SharedWorkerManager({
    debug: true // Enable debug logging in development
  });
  
  // Make it globally available for debugging
  self.sharedWorkerManager = manager;
}