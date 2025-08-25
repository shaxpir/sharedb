# SharedWorker Proxy Architecture Implementation Plan

## Overview

This plan outlines the implementation of a SharedWorker-based proxy system for ShareDB that solves the multi-tab IndexedDB conflict problem. The proxy layer will be completely transparent to existing code while providing a single shared Connection and DurableStore across all browser tabs.

## Problem Statement

**Current Issues with Multi-Tab ShareDB Applications:**
- Each tab creates its own Connection with separate WebSocket
- Multiple tabs attempt to use the same IndexedDB storage simultaneously
- Race conditions and data corruption in DurableStore operations
- Inconsistent document state between tabs
- Wasted network resources (N WebSockets for N tabs)
- No real-time synchronization between tabs

## Solution Architecture

**Core Concept:** Single SharedWorker hosts the real ShareDB Connection, with lightweight proxy objects in each tab communicating via BroadcastChannel.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│      Tab 1      │    │      Tab 2      │    │      Tab N      │
│                 │    │                 │    │                 │
│ ProxyConnection │    │ ProxyConnection │    │ ProxyConnection │
│   ProxyDoc(s)   │    │   ProxyDoc(s)   │    │   ProxyDoc(s)   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                        BroadcastChannel
                                 │
                    ┌────────────┼────────────┐
                    │    SharedWorker         │
                    │                         │
                    │  Real Connection        │
                    │  Real DurableStore      │
                    │  Real WebSocket         │
                    │  Single IndexedDB       │
                    └─────────────────────────┘
```

## Implementation Phases

### Phase 1: Core Infrastructure
**Files to Create:**
- `lib/client/proxy/shared-worker-manager.js` - SharedWorker host
- `lib/client/proxy/message-broker.js` - BroadcastChannel communication
- `lib/client/proxy/proxy-connection.js` - Connection proxy implementation
- `lib/client/proxy/proxy-doc.js` - Doc proxy implementation

**Key Components:**
1. **SharedWorkerManager**
   - Hosts the real ShareDB Connection and DurableStore
   - Manages document lifecycle and subscriptions
   - Handles WebSocket connection and reconnection logic

2. **MessageBroker** 
   - Abstracts BroadcastChannel communication
   - Handles message serialization/deserialization
   - Manages callback routing and event distribution

3. **ProxyConnection**
   - Mirrors the Connection API exactly
   - Forwards all method calls to SharedWorker via BroadcastChannel
   - Maintains local state for synchronous properties (id, state, etc.)

4. **ProxyDoc**
   - Mirrors the Doc API exactly
   - Forwards operations and subscriptions to SharedWorker
   - Receives and emits events from SharedWorker

### Phase 2: Message Protocol Design

**Message Types:**

```javascript
// Tab → SharedWorker Messages
{
  type: 'connection.get',
  collection: string,
  id: string,
  callbackId: string
}

{
  type: 'doc.subscribe', 
  collection: string,
  id: string,
  callbackId: string
}

{
  type: 'doc.submitOp',
  collection: string,
  id: string,
  op: any[],
  source: any,
  callbackId: string
}

{
  type: 'connection.getBulk',
  collection: string,
  ids: string[],
  callbackId: string
}

// SharedWorker → Tab Messages  
{
  type: 'callback',
  callbackId: string,
  error: Error | null,
  result: any
}

{
  type: 'doc.event',
  collection: string,
  id: string,
  event: string,
  args: any[]
}

{
  type: 'connection.event',
  event: string,
  args: any[]
}
```

### Phase 3: Proxy Implementation Details

**ProxyConnection Implementation:**
```javascript
function ProxyConnection(options) {
  this.id = generateId();
  this.state = 'connecting';
  this._messageBroker = new MessageBroker();
  this._callbacks = new Map();
  this._collections = {};
}

ProxyConnection.prototype.get = function(collection, id) {
  var existing = this.getExisting(collection, id);
  if (existing) return existing;
  
  var doc = new ProxyDoc(this, collection, id);
  this._addDocToCache(doc);
  return doc;
};

ProxyConnection.prototype.getBulk = function(collection, ids, callback) {
  var callbackId = this._registerCallback(callback);
  this._messageBroker.send({
    type: 'connection.getBulk',
    collection: collection,
    ids: ids,
    callbackId: callbackId
  });
};
```

**ProxyDoc Implementation:**
```javascript
function ProxyDoc(connection, collection, id) {
  emitter.mixin(this);
  this.connection = connection;
  this.collection = collection;
  this.id = id;
  this.version = null;
  this.type = null;
  this.data = undefined;
}

ProxyDoc.prototype.subscribe = function(callback) {
  var callbackId = this.connection._registerCallback(callback);
  this.connection._messageBroker.send({
    type: 'doc.subscribe',
    collection: this.collection,
    id: this.id,
    callbackId: callbackId
  });
};
```

### Phase 4: SharedWorker Implementation

**shared-worker-manager.js:**
```javascript
// This runs in the SharedWorker context
var Backend = require('../../backend');
var DurableStore = require('../durable-store');

function SharedWorkerManager() {
  this.connections = new Map(); // tabId → connection state
  this.realConnection = null;
  this.durableStore = null;
  this.messageHandlers = new Map();
  
  this._setupMessageHandlers();
  this._initializeRealConnection();
}

SharedWorkerManager.prototype._handleConnectionGet = function(message, port) {
  var doc = this.realConnection.get(message.collection, message.id);
  
  // Set up event forwarding for this doc
  this._setupDocEventForwarding(doc, port);
  
  // Return the doc to the requesting tab
  port.postMessage({
    type: 'callback',
    callbackId: message.callbackId,
    error: null,
    result: this._serializeDoc(doc)
  });
};
```

### Phase 5: Integration and Factory

**proxy-factory.js:**
```javascript
/**
 * Factory function that creates either a regular Connection or ProxyConnection
 * based on SharedWorker support and configuration
 */
function createConnection(backend, options) {
  options = options || {};
  
  // Check if we should use SharedWorker proxy
  var useProxy = options.useSharedWorker !== false && 
                 typeof SharedWorker !== 'undefined' &&
                 typeof BroadcastChannel !== 'undefined';
  
  if (useProxy) {
    return new ProxyConnection(options);
  } else {
    return backend.connect();
  }
}

module.exports = {
  createConnection: createConnection,
  ProxyConnection: ProxyConnection,
  SharedWorkerManager: SharedWorkerManager
};
```

### Phase 6: Error Handling and Edge Cases

**Critical Scenarios to Handle:**
1. **SharedWorker Termination**
   - Graceful degradation to direct connection
   - Automatic reconnection attempts
   - State synchronization on recovery

2. **Tab Lifecycle Management**
   - Cleanup when tabs close
   - Memory leak prevention
   - Orphaned subscription cleanup

3. **Message Delivery Guarantees**
   - Callback timeout handling
   - Retry logic for failed messages
   - Order preservation for operations

4. **Concurrent Operations**
   - Operation sequencing across tabs
   - Conflict resolution
   - Atomic batch operations

### Phase 7: Testing Strategy

**Unit Tests:**
- `test/client/proxy/message-broker-test.js`
- `test/client/proxy/proxy-connection-test.js` 
- `test/client/proxy/proxy-doc-test.js`
- `test/client/proxy/shared-worker-manager-test.js`

**Integration Tests:**
- `test/client/proxy/multi-tab-integration-test.js`
- `test/client/proxy/durable-store-proxy-test.js`
- `test/client/proxy/bulk-operations-proxy-test.js`

**Test Scenarios:**
```javascript
describe('Multi-Tab Proxy System', function() {
  it('should sync document changes between tabs', function(done) {
    // Create two proxy connections (simulating two tabs)
    var connection1 = new ProxyConnection();
    var connection2 = new ProxyConnection();
    
    var doc1 = connection1.get('test', 'doc1');
    var doc2 = connection2.get('test', 'doc1');
    
    doc1.create({text: 'hello'});
    
    doc2.on('create', function() {
      expect(doc2.data.text).to.equal('hello');
      done();
    });
  });
  
  it('should handle SharedWorker termination gracefully', function(done) {
    // Test graceful degradation scenarios
  });
  
  it('should prevent IndexedDB conflicts', function(done) {
    // Test concurrent DurableStore operations
  });
});
```

**Browser Testing:**
- Multi-tab manual testing scenarios
- SharedWorker support detection
- BroadcastChannel reliability testing
- Memory leak detection across tab opens/closes

### Phase 8: Documentation

**API Documentation:**
- `SHARED_WORKER_PROXY_API.md` - Complete API reference
- Update main README.md with multi-tab capabilities
- Migration guide for existing applications
- Configuration options and browser support matrix

**Usage Examples:**
```javascript
// examples/multi-tab-collaboration.js
var sharedb = require('sharedb/lib/client');
var ProxyConnection = require('sharedb/lib/client/proxy/proxy-connection');

// Automatically use SharedWorker when available
var connection = sharedb.createConnection({
  useSharedWorker: true // default: true
});

// Use exactly like a regular connection
var doc = connection.get('documents', 'my-doc');
doc.subscribe();
doc.on('op', function(op, source) {
  console.log('Document updated:', op);
  // This event fires in ALL tabs when ANY tab modifies the document
});
```

**Developer Guide Sections:**
1. **When to Use SharedWorker Proxy**
   - Multi-tab applications
   - Applications using DurableStore
   - Memory-constrained environments

2. **Browser Compatibility**
   - SharedWorker support matrix
   - Graceful degradation strategies
   - Feature detection examples

3. **Debugging Multi-Tab Issues**
   - SharedWorker DevTools access
   - Message tracing and logging
   - Common pitfalls and solutions

### Phase 9: Performance and Optimization

**Performance Considerations:**
- Message serialization overhead
- Memory usage across tabs vs single connection
- Network efficiency gains
- IndexedDB contention elimination

**Optimization Strategies:**
- Message batching for bulk operations
- Event coalescing to reduce cross-tab noise
- Lazy proxy object creation
- Smart cache invalidation

## Success Metrics

**Functional Goals:**
- ✅ Zero API changes required for existing code
- ✅ Complete feature parity with direct Connection
- ✅ Eliminates IndexedDB conflicts between tabs
- ✅ Real-time document sync between tabs
- ✅ Single WebSocket connection per browser

**Performance Goals:**
- 🎯 Reduced memory usage in multi-tab scenarios
- 🎯 Faster document loading (shared cache benefits)
- 🎯 Reduced network traffic (single connection)
- 🎯 No measurable latency increase for operations

**Reliability Goals:**
- 🛡️ Graceful degradation when SharedWorker unavailable
- 🛡️ Robust error handling and recovery
- 🛡️ Memory leak prevention
- 🛡️ Tab cleanup on browser close

## Risk Assessment

**Technical Risks:**
- **SharedWorker Browser Support**: Mitigation via graceful degradation
- **BroadcastChannel Reliability**: Fallback to direct connection
- **Message Serialization Complexity**: Comprehensive testing required
- **Memory Management**: Careful lifecycle management and cleanup

**Implementation Risks:**
- **API Surface Completeness**: Must mirror every Connection/Doc method
- **Event Forwarding Accuracy**: Critical for real-time features
- **Race Condition Handling**: Requires careful synchronization
- **Testing Complexity**: Multi-process testing is challenging

## Timeline Estimate

**Phase 1-3: Core Architecture** (Week 1-2)
- Basic proxy objects and message protocol
- SharedWorker host implementation
- Simple get/subscribe functionality

**Phase 4-5: Full API Coverage** (Week 2-3)  
- Complete Connection/Doc API implementation
- Bulk operations proxy support
- Factory and integration patterns

**Phase 6-7: Polish and Testing** (Week 3-4)
- Comprehensive error handling
- Full test suite implementation
- Edge case coverage

**Phase 8-9: Documentation and Optimization** (Week 4)
- Complete documentation
- Performance tuning
- Browser compatibility testing

## Next Steps

1. **Validate Architecture**: Review this plan with stakeholders
2. **Create Prototype**: Implement basic ProxyConnection and messaging
3. **Test Multi-Tab Scenario**: Verify IndexedDB conflict resolution
4. **Iterate on Message Protocol**: Refine based on testing results
5. **Expand API Coverage**: Implement remaining Connection/Doc methods

This architecture would be a **major differentiator** for ShareDB, solving a fundamental problem that every collaborative application faces. The transparent proxy approach ensures maximum compatibility while delivering significant practical benefits.