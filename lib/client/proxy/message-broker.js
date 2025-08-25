var emitter = require('../../emitter');

/**
 * MessageBroker handles BroadcastChannel communication between tabs and SharedWorker.
 * It provides a clean abstraction over the message passing protocol and handles
 * callback routing, event distribution, and error handling.
 */
function MessageBroker(options) {
  if (!(this instanceof MessageBroker)) {
    return new MessageBroker(options);
  }
  
  emitter.mixin(this);
  
  options = options || {};
  
  this.channelName = options.channelName || 'sharedb-proxy';
  this.tabId = this._generateTabId();
  this.debug = options.debug || false;
  
  // Callback management
  this._callbacks = {};
  this._callbackCounter = 0;
  
  // Message queuing for when channel is not ready
  this._messageQueue = [];
  this._isReady = false;
  
  // BroadcastChannel setup
  this._channel = null;
  this._initializeChannel();
}

/**
 * Initialize the BroadcastChannel for communication
 */
MessageBroker.prototype._initializeChannel = function() {
  var broker = this;
  
  if (typeof BroadcastChannel === 'undefined') {
    this._logError('BroadcastChannel not supported in this environment');
    this.emit('error', new Error('BroadcastChannel not supported'));
    return;
  }
  
  try {
    this._channel = new BroadcastChannel(this.channelName);
    
    this._channel.onmessage = function(event) {
      broker._handleMessage(event.data);
    };
    
    this._channel.onerror = function(error) {
      broker._logError('BroadcastChannel error:', error);
      broker.emit('error', error);
    };
    
    this._isReady = true;
    this._flushMessageQueue();
    this.emit('ready');
    
    this._log('MessageBroker initialized for tab:', this.tabId);
  } catch (error) {
    this._logError('Failed to initialize BroadcastChannel:', error);
    this.emit('error', error);
  }
};

/**
 * Send a message with optional callback handling
 */
MessageBroker.prototype.send = function(message, callback) {
  if (callback) {
    var callbackId = this._registerCallback(callback);
    message.callbackId = callbackId;
  }
  
  // Add metadata
  message.tabId = this.tabId;
  message.timestamp = Date.now();
  
  if (!this._isReady) {
    this._messageQueue.push(message);
    this._log('Queued message:', message.type);
    return;
  }
  
  try {
    this._channel.postMessage(message);
    this._log('Sent message:', message.type, message.callbackId ? '(with callback)' : '');
  } catch (error) {
    this._logError('Failed to send message:', error);
    if (callback) {
      this._executeCallback(message.callbackId, error, null);
    }
  }
};

/**
 * Handle incoming messages from the BroadcastChannel
 */
MessageBroker.prototype._handleMessage = function(message) {
  if (!message || !message.type) {
    this._logError('Received invalid message:', message);
    return;
  }
  
  // Ignore messages from our own tab (shouldn't happen but safety first)
  if (message.tabId === this.tabId) {
    return;
  }
  
  this._log('Received message:', message.type, message.callbackId ? '(with callback)' : '');
  
  switch (message.type) {
    case 'callback':
      this._handleCallbackMessage(message);
      break;
      
    case 'doc.event':
      this._handleDocEvent(message);
      break;
      
    case 'connection.event':
      this._handleConnectionEvent(message);
      break;
      
    default:
      this._log('Unknown message type:', message.type);
      this.emit('message', message);
      break;
  }
};

/**
 * Handle callback response messages from SharedWorker
 */
MessageBroker.prototype._handleCallbackMessage = function(message) {
  if (!message.callbackId) {
    this._logError('Callback message missing callbackId:', message);
    return;
  }
  
  this._executeCallback(message.callbackId, message.error, message.result);
};

/**
 * Handle document events from SharedWorker
 */
MessageBroker.prototype._handleDocEvent = function(message) {
  if (!message.collection || !message.id || !message.event) {
    this._logError('Invalid doc event message:', message);
    return;
  }
  
  this.emit('doc.event', {
    collection: message.collection,
    id: message.id,
    event: message.event,
    args: message.args || []
  });
};

/**
 * Handle connection events from SharedWorker
 */
MessageBroker.prototype._handleConnectionEvent = function(message) {
  if (!message.event) {
    this._logError('Invalid connection event message:', message);
    return;
  }
  
  this.emit('connection.event', {
    event: message.event,
    args: message.args || []
  });
};

/**
 * Register a callback and return its ID
 */
MessageBroker.prototype._registerCallback = function(callback) {
  var callbackId = 'cb_' + this.tabId + '_' + (++this._callbackCounter);
  this._callbacks[callbackId] = {
    fn: callback,
    timestamp: Date.now()
  };
  return callbackId;
};

/**
 * Execute a callback and clean it up
 */
MessageBroker.prototype._executeCallback = function(callbackId, error, result) {
  var callbackInfo = this._callbacks[callbackId];
  if (!callbackInfo) {
    this._logError('Callback not found:', callbackId);
    return;
  }
  
  delete this._callbacks[callbackId];
  
  try {
    callbackInfo.fn(error, result);
  } catch (err) {
    this._logError('Error executing callback:', err);
    this.emit('error', err);
  }
};

/**
 * Clean up expired callbacks to prevent memory leaks
 */
MessageBroker.prototype._cleanupCallbacks = function(maxAge) {
  maxAge = maxAge || 30000; // 30 seconds default
  var now = Date.now();
  var cleaned = 0;
  
  for (var callbackId in this._callbacks) {
    if (this._callbacks.hasOwnProperty(callbackId)) {
      var callback = this._callbacks[callbackId];
      if (now - callback.timestamp > maxAge) {
        delete this._callbacks[callbackId];
        cleaned++;
      }
    }
  }
  
  if (cleaned > 0) {
    this._log('Cleaned up', cleaned, 'expired callbacks');
  }
};

/**
 * Flush queued messages when channel becomes ready
 */
MessageBroker.prototype._flushMessageQueue = function() {
  if (this._messageQueue.length === 0) {
    return;
  }
  
  this._log('Flushing', this._messageQueue.length, 'queued messages');
  
  var queue = this._messageQueue;
  this._messageQueue = [];
  
  for (var i = 0; i < queue.length; i++) {
    this.send(queue[i]);
  }
};

/**
 * Generate a unique tab ID
 */
MessageBroker.prototype._generateTabId = function() {
  return 'tab_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
};

/**
 * Check if the broker is ready to send messages
 */
MessageBroker.prototype.isReady = function() {
  return this._isReady && this._channel;
};

/**
 * Get statistics about the broker state
 */
MessageBroker.prototype.getStats = function() {
  return {
    tabId: this.tabId,
    isReady: this._isReady,
    queuedMessages: this._messageQueue.length,
    pendingCallbacks: Object.keys(this._callbacks).length,
    channelName: this.channelName
  };
};

/**
 * Close the broker and clean up resources
 */
MessageBroker.prototype.close = function() {
  this._log('Closing MessageBroker for tab:', this.tabId);
  
  // Clean up all pending callbacks with error
  for (var callbackId in this._callbacks) {
    if (this._callbacks.hasOwnProperty(callbackId)) {
      var callback = this._callbacks[callbackId];
      try {
        callback.fn(new Error('MessageBroker closed'));
      } catch (err) {
        // Ignore errors in cleanup
      }
    }
  }
  this._callbacks = {};
  
  // Close channel
  if (this._channel) {
    this._channel.close();
    this._channel = null;
  }
  
  this._isReady = false;
  this._messageQueue = [];
  this.emit('close');
};

/**
 * Start periodic cleanup of expired callbacks
 */
MessageBroker.prototype.startCleanupTimer = function(interval) {
  interval = interval || 10000; // 10 seconds default
  
  var broker = this;
  this._cleanupTimer = setInterval(function() {
    broker._cleanupCallbacks();
  }, interval);
};

/**
 * Stop periodic cleanup
 */
MessageBroker.prototype.stopCleanupTimer = function() {
  if (this._cleanupTimer) {
    clearInterval(this._cleanupTimer);
    this._cleanupTimer = null;
  }
};

/**
 * Logging helpers
 */
MessageBroker.prototype._log = function() {
  if (this.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[MessageBroker]');
    console.log.apply(console, args);
  }
};

MessageBroker.prototype._logError = function() {
  if (this.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[MessageBroker ERROR]');
    console.error.apply(console, args);
  }
};

module.exports = MessageBroker;