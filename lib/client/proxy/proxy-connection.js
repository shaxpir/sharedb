var emitter = require('../../emitter');
var MessageBroker = require('./message-broker');
var ProxyDoc = require('./proxy-doc');

/**
 * ProxyConnection provides a transparent proxy to a ShareDB Connection running in a SharedWorker.
 * It mirrors the entire Connection API and forwards all operations to the SharedWorker.
 */
function ProxyConnection(options) {
  if (!(this instanceof ProxyConnection)) {
    return new ProxyConnection(options);
  }
  
  emitter.mixin(this);
  
  options = options || {};
  
  // Connection properties (mirroring real Connection)
  this.id = this._generateId();
  this.state = 'connecting';
  this.canSend = false;
  
  // Document cache (same structure as real Connection)
  this.collections = {};
  
  // Proxy-specific properties
  this._messageBroker = new MessageBroker({
    channelName: options.channelName || 'sharedb-proxy',
    debug: options.debug || false
  });
  
  // Set up message broker event handling
  this._setupMessageBrokerEvents();
  
  // Initialize with SharedWorker
  this._initialize();
}

/**
 * Set up event handling from the MessageBroker
 */
ProxyConnection.prototype._setupMessageBrokerEvents = function() {
  var connection = this;
  
  this._messageBroker.on('ready', function() {
    connection._onBrokerReady();
  });
  
  this._messageBroker.on('error', function(error) {
    connection.emit('error', error);
  });
  
  this._messageBroker.on('doc.event', function(eventData) {
    connection._handleDocEvent(eventData);
  });
  
  this._messageBroker.on('connection.event', function(eventData) {
    connection._handleConnectionEvent(eventData);
  });
};

/**
 * Initialize the proxy connection with the SharedWorker
 */
ProxyConnection.prototype._initialize = function() {
  // Start cleanup timer for the message broker
  this._messageBroker.startCleanupTimer();
  
  // Register this tab with the SharedWorker
  this._messageBroker.send({
    type: 'tab.register'
  });
};

/**
 * Handle MessageBroker ready event
 */
ProxyConnection.prototype._onBrokerReady = function() {
  this.state = 'connected';
  this.canSend = true;
  this.emit('state', this.state, 'MessageBroker ready');
};

/**
 * Handle document events from SharedWorker
 */
ProxyConnection.prototype._handleDocEvent = function(eventData) {
  var collection = eventData.collection;
  var id = eventData.id;
  var event = eventData.event;
  var args = eventData.args;
  
  // Find the proxy document
  var doc = this.getExisting(collection, id);
  if (doc) {
    // Forward the event to the proxy document
    doc._handleEvent(event, args);
  }
};

/**
 * Handle connection events from SharedWorker
 */
ProxyConnection.prototype._handleConnectionEvent = function(eventData) {
  var event = eventData.event;
  var args = eventData.args;
  
  // Update local state based on connection events
  if (event === 'state') {
    this.state = args[0];
    this.canSend = (this.state === 'connected');
  }
  
  // Forward the event
  this.emit(event, args[0], args[1], args[2]);
};

/**
 * Get a document (same API as real Connection)
 */
ProxyConnection.prototype.get = function(collection, id) {
  var existing = this.getExisting(collection, id);
  if (existing) {
    return existing;
  }
  
  // Create new proxy document
  var doc = new ProxyDoc(this, collection, id);
  this._addDocToCache(doc);
  
  return doc;
};

/**
 * Get existing document from cache (same API as real Connection)
 */
ProxyConnection.prototype.getExisting = function(collection, id) {
  var collectionDocs = this.collections[collection];
  return collectionDocs && collectionDocs[id];
};

/**
 * Add document to cache
 */
ProxyConnection.prototype._addDocToCache = function(doc) {
  if (!this.collections[doc.collection]) {
    this.collections[doc.collection] = {};
  }
  this.collections[doc.collection][doc.id] = doc;
};

/**
 * Remove document from cache
 */
ProxyConnection.prototype._removeDocFromCache = function(doc) {
  var collectionDocs = this.collections[doc.collection];
  if (collectionDocs) {
    delete collectionDocs[doc.id];
    if (Object.keys(collectionDocs).length === 0) {
      delete this.collections[doc.collection];
    }
  }
};

/**
 * Bulk document loading (mirrors Connection.getBulk)
 */
ProxyConnection.prototype.getBulk = function(collection, ids, callback) {
  if (!Array.isArray(ids)) {
    return callback(new Error('ids must be an array'));
  }
  
  if (ids.length === 0) {
    return callback(null, []);
  }
  
  var connection = this;
  var results = [];
  var uncachedIds = [];
  var cachedDocs = {};
  
  // Check cache first (same logic as real Connection)
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var doc = this.getExisting(collection, id);
    
    if (doc) {
      cachedDocs[id] = doc;
    } else {
      uncachedIds.push(id);
      // Create the Doc object now so it's in cache
      cachedDocs[id] = this.get(collection, id);
    }
  }
  
  // If all documents are cached, return immediately
  if (uncachedIds.length === 0) {
    for (var j = 0; j < ids.length; j++) {
      results.push(cachedDocs[ids[j]]);
    }
    return callback(null, results);
  }
  
  // Request uncached documents from SharedWorker
  this._messageBroker.send({
    type: 'connection.getBulk',
    collection: collection,
    ids: uncachedIds
  }, function(error, docDatas) {
    if (error) return callback(error);
    
    // Update proxy documents with data from SharedWorker
    if (docDatas && docDatas.length > 0) {
      for (var k = 0; k < docDatas.length; k++) {
        var docData = docDatas[k];
        var doc = cachedDocs[docData.id];
        if (doc) {
          doc._updateFromSharedWorker(docData);
        }
      }
    }
    
    // Return docs in original order
    for (var l = 0; l < ids.length; l++) {
      results.push(cachedDocs[ids[l]]);
    }
    callback(null, results);
  });
};

/**
 * Auto-flush control (mirrors Connection API)
 */
ProxyConnection.prototype.setAutoFlush = function(enabled) {
  this._messageBroker.send({
    type: 'connection.setAutoFlush',
    enabled: enabled
  });
};

ProxyConnection.prototype.isAutoFlush = function() {
  // This would need to be synchronous, so we'll need to maintain local state
  // For now, return a sensible default
  return true;
};

/**
 * Document writing methods (mirrors Connection API)
 */
ProxyConnection.prototype.putDoc = function(doc, callback) {
  this._messageBroker.send({
    type: 'connection.putDoc',
    collection: doc.collection,
    id: doc.id
  }, callback);
};

ProxyConnection.prototype.putDocs = function(docs, callback) {
  var docRefs = [];
  for (var i = 0; i < docs.length; i++) {
    docRefs.push({
      collection: docs[i].collection,
      id: docs[i].id
    });
  }
  
  this._messageBroker.send({
    type: 'connection.putDocs',
    docs: docRefs
  }, callback);
};

ProxyConnection.prototype.putDocsBulk = function(docs, callback) {
  var docRefs = [];
  for (var i = 0; i < docs.length; i++) {
    docRefs.push({
      collection: docs[i].collection,
      id: docs[i].id
    });
  }
  
  this._messageBroker.send({
    type: 'connection.putDocsBulk',
    docs: docRefs
  }, callback);
};

ProxyConnection.prototype.flushWrites = function(callback) {
  this._messageBroker.send({
    type: 'connection.flushWrites'
  }, callback);
};

/**
 * Queue inspection methods (mirrors Connection API)
 */
ProxyConnection.prototype.getWriteQueueSize = function() {
  // This needs to be synchronous, so we'd need to maintain local state
  // For now, return 0 as default
  return 0;
};

ProxyConnection.prototype.hasPendingWrites = function() {
  // This needs to be synchronous, so we'd need to maintain local state
  // For now, return false as default
  return false;
};

/**
 * Query methods (mirrors Connection API)
 */
ProxyConnection.prototype.createQuery = function(collection, query, options) {
  // TODO: Implement proxy query support
  throw new Error('Queries not yet supported in ProxyConnection');
};

ProxyConnection.prototype.createSubscribeQuery = function(collection, query, options, callback) {
  // TODO: Implement proxy query support
  throw new Error('Queries not yet supported in ProxyConnection');
};

ProxyConnection.prototype.createFetchQuery = function(collection, query, options, callback) {
  // TODO: Implement proxy query support
  throw new Error('Queries not yet supported in ProxyConnection');
};

/**
 * Presence methods (mirrors Connection API)
 */
ProxyConnection.prototype.presence = function(channel) {
  // TODO: Implement proxy presence support
  throw new Error('Presence not yet supported in ProxyConnection');
};

/**
 * Close the proxy connection
 */
ProxyConnection.prototype.close = function() {
  // Notify SharedWorker that this tab is closing
  this._messageBroker.send({
    type: 'tab.unregister'
  });
  
  // Close the message broker
  this._messageBroker.stopCleanupTimer();
  this._messageBroker.close();
  
  // Clean up local state
  this.state = 'closed';
  this.canSend = false;
  this.collections = {};
  
  this.emit('state', this.state, 'ProxyConnection closed');
};

/**
 * Generate a unique connection ID
 */
ProxyConnection.prototype._generateId = function() {
  return 'proxy_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
};

/**
 * Get statistics about the proxy connection
 */
ProxyConnection.prototype.getStats = function() {
  var docCount = 0;
  for (var collection in this.collections) {
    if (this.collections.hasOwnProperty(collection)) {
      docCount += Object.keys(this.collections[collection]).length;
    }
  }
  
  return {
    id: this.id,
    state: this.state,
    canSend: this.canSend,
    cachedDocuments: docCount,
    messageBroker: this._messageBroker.getStats()
  };
};

/**
 * Debug method to inspect the connection state
 */
ProxyConnection.prototype._debug = function() {
  return {
    stats: this.getStats(),
    collections: this.collections
  };
};

module.exports = ProxyConnection;