var emitter = require('../../emitter');

/**
 * ProxyDoc provides a transparent proxy to a ShareDB Doc running in a SharedWorker.
 * It mirrors the entire Doc API and forwards all operations to the SharedWorker.
 */
function ProxyDoc(connection, collection, id) {
  if (!(this instanceof ProxyDoc)) {
    return new ProxyDoc(connection, collection, id);
  }
  
  emitter.mixin(this);
  
  // Core document properties (mirroring real Doc)
  this.connection = connection;
  this.collection = collection;
  this.id = id;
  
  // Document state
  this.version = null;
  this.type = null;
  this.data = undefined;
  
  // Subscription and operation state
  this.subscribed = false;
  this.wantSubscribe = false;
  this.subscribeCallback = null;
  
  // Operation tracking
  this.pendingOps = [];
  this.inflightOp = null;
  this.preventCompose = false;
  
  // Source tracking for operations
  this.submitSource = null;
  
  // Proxy-specific state
  this._syncedWithSharedWorker = false;
}

/**
 * Subscribe to the document (mirrors Doc.subscribe)
 */
ProxyDoc.prototype.subscribe = function(callback) {
  if (this.subscribed) {
    if (callback) callback(null);
    return;
  }
  
  this.wantSubscribe = true;
  this.subscribeCallback = callback;
  
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.subscribe',
    collection: this.collection,
    id: this.id
  }, function(error, docData) {
    if (error) {
      doc.wantSubscribe = false;
      doc.subscribeCallback = null;
      if (callback) callback(error);
      return;
    }
    
    // Update document state from SharedWorker response
    if (docData) {
      doc._updateFromSharedWorker(docData);
    }
    
    doc.subscribed = true;
    doc.subscribeCallback = null;
    
    if (callback) callback(null);
    doc.emit('subscribe');
  });
};

/**
 * Unsubscribe from the document (mirrors Doc.unsubscribe)
 */
ProxyDoc.prototype.unsubscribe = function(callback) {
  if (!this.subscribed && !this.wantSubscribe) {
    if (callback) callback(null);
    return;
  }
  
  this.wantSubscribe = false;
  this.subscribed = false;
  
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.unsubscribe',
    collection: this.collection,
    id: this.id
  }, function(error) {
    if (callback) callback(error);
    if (!error) {
      doc.emit('unsubscribe');
    }
  });
};

/**
 * Fetch the document without subscribing (mirrors Doc.fetch)
 */
ProxyDoc.prototype.fetch = function(callback) {
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.fetch',
    collection: this.collection,
    id: this.id
  }, function(error, docData) {
    if (error) {
      if (callback) callback(error);
      return;
    }
    
    if (docData) {
      doc._updateFromSharedWorker(docData);
    }
    
    if (callback) callback(null);
  });
};

/**
 * Create the document (mirrors Doc.create)
 */
ProxyDoc.prototype.create = function(data, type, options, callback) {
  // Handle optional parameters
  if (typeof type === 'function') {
    callback = type;
    type = null;
    options = null;
  } else if (typeof options === 'function') {
    callback = options;
    options = null;
  }
  
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.create',
    collection: this.collection,
    id: this.id,
    data: data,
    docType: type,
    options: options
  }, function(error, docData) {
    if (error) {
      if (callback) callback(error);
      return;
    }
    
    if (docData) {
      doc._updateFromSharedWorker(docData);
    }
    
    if (callback) callback(null);
  });
};

/**
 * Submit an operation (mirrors Doc.submitOp)
 */
ProxyDoc.prototype.submitOp = function(op, source, callback) {
  // Handle optional source parameter
  if (typeof source === 'function') {
    callback = source;
    source = null;
  }
  
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.submitOp',
    collection: this.collection,
    id: this.id,
    op: op,
    source: source
  }, function(error) {
    if (callback) callback(error);
  });
  
  // Optimistic update: apply operation immediately to local data
  if (this.data !== undefined) {
    try {
      this._applyOperationToData(op);
      this.version = (this.version || 0) + 1;
    } catch (error) {
      console.error('Failed to apply optimistic operation:', error);
    }
  }
  
  // Track pending ops for conflict resolution
  this.pendingOps.push({
    op: op,
    source: source
  });
};

/**
 * Delete the document (mirrors Doc.del)
 */
ProxyDoc.prototype.del = function(source, callback) {
  // Handle optional source parameter
  if (typeof source === 'function') {
    callback = source;
    source = null;
  }
  
  var doc = this;
  this.connection._messageBroker.send({
    type: 'doc.del',
    collection: this.collection,
    id: this.id,
    source: source
  }, function(error) {
    if (callback) callback(error);
  });
};

/**
 * Check if document has pending operations
 */
ProxyDoc.prototype.hasPendingOps = function() {
  return this.pendingOps.length > 0 || !!this.inflightOp;
};

/**
 * Flush pending operations (mirrors Doc.flush)
 */
ProxyDoc.prototype.flush = function(callback) {
  // This would be complex to implement correctly in proxy mode
  // For now, just call the callback
  if (callback) {
    setTimeout(callback, 0);
  }
};

/**
 * Pause document operations (mirrors Doc.pause)
 */
ProxyDoc.prototype.pause = function() {
  this.connection._messageBroker.send({
    type: 'doc.pause',
    collection: this.collection,
    id: this.id
  });
};

/**
 * Resume document operations (mirrors Doc.resume)
 */
ProxyDoc.prototype.resume = function() {
  this.connection._messageBroker.send({
    type: 'doc.resume',
    collection: this.collection,
    id: this.id
  });
};

/**
 * Handle events forwarded from the SharedWorker
 */
ProxyDoc.prototype._handleEvent = function(event, args) {
  switch (event) {
    case 'load':
      this._handleLoadEvent();
      break;
    case 'create':
      this._handleCreateEvent(args[0]);
      break;
    case 'op':
      this._handleOpEvent(args[0], args[1]);
      break;
    case 'del':
      this._handleDelEvent(args[0], args[1]);
      break;
    case 'error':
      this._handleErrorEvent(args[0]);
      break;
    default:
      // Forward unknown events as-is
      this.emit.apply(this, [event].concat(args));
      break;
  }
};

/**
 * Handle load event from SharedWorker
 */
ProxyDoc.prototype._handleLoadEvent = function() {
  this.emit('load');
};

/**
 * Handle create event from SharedWorker
 */
ProxyDoc.prototype._handleCreateEvent = function(source) {
  // Create events should include the initial data
  // This will be sent in the SharedWorker response, but we should also
  // handle cases where create event is broadcasted
  this.version = 1;
  this.emit('create', source);
};

/**
 * Handle operation event from SharedWorker
 */
ProxyDoc.prototype._handleOpEvent = function(op, source) {
  // Remove matching operation from pending ops
  for (var i = 0; i < this.pendingOps.length; i++) {
    var pendingOp = this.pendingOps[i];
    if (this._opsEqual(pendingOp.op, op) && pendingOp.source === source) {
      this.pendingOps.splice(i, 1);
      break;
    }
  }
  
  // Apply the operation to local data (if we have data)
  if (this.data !== undefined && op) {
    try {
      this._applyOperationToData(op);
      this.version = (this.version || 0) + 1;
    } catch (error) {
      console.error('Failed to apply operation to proxy doc data:', error);
      // Still emit the op event even if local application fails
    }
  }
  
  this.emit('op', op, source);
};

/**
 * Handle delete event from SharedWorker
 */
ProxyDoc.prototype._handleDelEvent = function(data, source) {
  this.emit('del', data, source);
};

/**
 * Handle error event from SharedWorker
 */
ProxyDoc.prototype._handleErrorEvent = function(error) {
  // Reconstruct error object if it was serialized
  if (error && typeof error === 'object' && error.message) {
    var err = new Error(error.message);
    err.code = error.code;
    err.stack = error.stack;
    error = err;
  }
  
  this.emit('error', error);
};

/**
 * Update document state from SharedWorker data
 */
ProxyDoc.prototype._updateFromSharedWorker = function(docData) {
  if (!docData) return;
  
  // Update document properties
  if (docData.version !== undefined) {
    this.version = docData.version;
  }
  
  if (docData.type !== undefined) {
    this.type = docData.type;
  }
  
  if (docData.data !== undefined) {
    this.data = docData.data;
  }
  
  if (docData.subscribed !== undefined) {
    this.subscribed = docData.subscribed;
  }
  
  if (docData.inflightOp !== undefined) {
    this.inflightOp = docData.inflightOp;
  }
  
  this._syncedWithSharedWorker = true;
};

/**
 * Compare two operations for equality (simplified)
 */
ProxyDoc.prototype._opsEqual = function(op1, op2) {
  // This is a simplified comparison - real implementation would be more thorough
  return JSON.stringify(op1) === JSON.stringify(op2);
};

/**
 * Apply an operation to the local data object
 * This implements basic JSON0 operation transform logic
 */
ProxyDoc.prototype._applyOperationToData = function(op) {
  if (!Array.isArray(op)) {
    op = [op];
  }
  
  for (var i = 0; i < op.length; i++) {
    this._applyOperationComponent(op[i], this.data);
  }
};

/**
 * Apply a single operation component to data
 */
ProxyDoc.prototype._applyOperationComponent = function(opComponent, data) {
  var path = opComponent.p || [];
  
  // Navigate to the target location
  var target = data;
  var parent = null;
  var key = null;
  
  for (var i = 0; i < path.length - 1; i++) {
    var segment = path[i];
    if (target[segment] === undefined) {
      // Path doesn't exist - create structure as needed
      target[segment] = (typeof path[i + 1] === 'number') ? [] : {};
    }
    target = target[segment];
  }
  
  if (path.length > 0) {
    parent = target;
    key = path[path.length - 1];
    target = target[key];
  }
  
  // Apply the operation based on type
  if (opComponent.hasOwnProperty('oi')) {
    // Object insert/replace
    if (parent) {
      parent[key] = opComponent.oi;
    } else {
      // Root replacement
      this.data = opComponent.oi;
    }
  } else if (opComponent.hasOwnProperty('od')) {
    // Object delete
    if (parent) {
      delete parent[key];
    } else {
      this.data = undefined;
    }
  } else if (opComponent.hasOwnProperty('na')) {
    // Number add
    if (parent) {
      parent[key] = (parent[key] || 0) + opComponent.na;
    }
  } else if (opComponent.hasOwnProperty('li')) {
    // List insert
    if (parent && Array.isArray(parent[key])) {
      parent[key].splice(key, 0, opComponent.li);
    }
  } else if (opComponent.hasOwnProperty('ld')) {
    // List delete
    if (parent && Array.isArray(parent[key])) {
      parent[key].splice(key, 1);
    }
  } else if (opComponent.hasOwnProperty('lm')) {
    // List move
    if (parent && Array.isArray(parent)) {
      var item = parent.splice(key, 1)[0];
      parent.splice(opComponent.lm, 0, item);
    }
  } else if (opComponent.hasOwnProperty('si')) {
    // String insert
    if (parent && typeof parent[key] === 'string') {
      var str = parent[key];
      var insertPos = path.length > 0 ? key : 0;
      parent[key] = str.slice(0, insertPos) + opComponent.si + str.slice(insertPos);
    }
  } else if (opComponent.hasOwnProperty('sd')) {
    // String delete
    if (parent && typeof parent[key] === 'string') {
      var str = parent[key];
      var deletePos = path.length > 0 ? key : 0;
      parent[key] = str.slice(0, deletePos) + str.slice(deletePos + opComponent.sd.length);
    }
  }
  
  // Handle subtype operations (delegated to type-specific handlers)
  if (opComponent.t && opComponent.o) {
    // This would require loading the specific OT type
    // For now, we'll skip subtype operations
    console.warn('Subtype operations not yet supported in ProxyDoc');
  }
};

/**
 * Handle fetch results (used by Connection.getBulk and direct fetch calls)
 */
ProxyDoc.prototype._handleFetch = function(error, docData) {
  if (error) {
    this.emit('error', error);
    return;
  }
  
  if (docData) {
    this._updateFromSharedWorker(docData);
    this.emit('load');
  }
};

/**
 * Get the document key (collection/id)
 */
ProxyDoc.prototype.getKey = function() {
  return this.collection + '/' + this.id;
};

/**
 * Check if the document exists (has been created)
 */
ProxyDoc.prototype.exists = function() {
  return this.version !== null && this.version > 0;
};

/**
 * Get snapshot data for serialization
 */
ProxyDoc.prototype.getSnapshot = function() {
  return {
    id: this.id,
    v: this.version,
    type: this.type,
    data: this.data
  };
};

/**
 * Clone the document data
 */
ProxyDoc.prototype.clone = function() {
  if (this.data === undefined) {
    return undefined;
  }
  
  // Deep clone the data
  return JSON.parse(JSON.stringify(this.data));
};

/**
 * Get document statistics
 */
ProxyDoc.prototype.getStats = function() {
  return {
    collection: this.collection,
    id: this.id,
    version: this.version,
    type: this.type,
    subscribed: this.subscribed,
    wantSubscribe: this.wantSubscribe,
    hasPendingOps: this.hasPendingOps(),
    pendingOpsCount: this.pendingOps.length,
    syncedWithSharedWorker: this._syncedWithSharedWorker
  };
};

/**
 * Debug method to inspect the document state
 */
ProxyDoc.prototype._debug = function() {
  return {
    stats: this.getStats(),
    data: this.data,
    pendingOps: this.pendingOps,
    inflightOp: this.inflightOp
  };
};

/**
 * Destroy the proxy document (clean up resources)
 */
ProxyDoc.prototype.destroy = function() {
  // Unsubscribe if subscribed
  if (this.subscribed || this.wantSubscribe) {
    this.unsubscribe();
  }
  
  // Remove from connection cache
  this.connection._removeDocFromCache(this);
  
  // Clear all listeners
  this.removeAllListeners();
  
  // Clear references
  this.connection = null;
  this.data = undefined;
  this.pendingOps = [];
  this.inflightOp = null;
};

module.exports = ProxyDoc;