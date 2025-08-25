/**
 * ShareDB SharedWorker Proxy Example
 * 
 * This example demonstrates how to use the SharedWorker proxy system
 * to enable multi-tab collaboration with a single shared connection.
 */

var ShareDB = require('../lib/client');

// The proxy system will automatically detect browser capabilities
// and choose the best connection type (proxy vs direct)

console.log('Checking proxy capabilities...');
var capabilities = ShareDB.proxy.getProxyCapabilities();
console.log('Proxy capabilities:', capabilities);

if (capabilities.canUseProxy) {
  console.log('✓ Browser supports SharedWorker proxy system');
} else {
  console.log('⚠ Browser does not support proxy - will use direct connection');
  console.log('Missing capabilities:');
  if (!capabilities.hasSharedWorker) console.log('  - SharedWorker not available');
  if (!capabilities.hasBroadcastChannel) console.log('  - BroadcastChannel not available');
}

// Create a connection using the proxy system
// This will automatically choose between ProxyConnection and regular Connection
var connection = ShareDB.proxy.createConnection(null, {
  debug: true, // Enable debug logging
  channelName: 'my-app-sharedb' // Custom channel name
});

console.log('Created connection:', connection.constructor.name);
console.log('Connection ID:', connection.id);

// The connection API is identical whether using proxy or direct connection
var doc1 = connection.get('documents', 'example-doc-1');
var doc2 = connection.get('documents', 'example-doc-2');

console.log('Created documents:', doc1.id, doc2.id);

// Subscribe to documents for real-time updates
doc1.subscribe(function(error) {
  if (error) {
    console.error('Failed to subscribe to doc1:', error);
    return;
  }
  
  console.log('✓ Subscribed to doc1');
  
  // Create the document if it doesn't exist
  if (!doc1.data) {
    doc1.create({
      title: 'Example Document 1',
      content: 'This is a collaborative document',
      created: new Date().toISOString()
    });
    console.log('Created doc1 with initial data');
  } else {
    console.log('Doc1 already exists:', doc1.data);
  }
});

doc2.subscribe(function(error) {
  if (error) {
    console.error('Failed to subscribe to doc2:', error);
    return;
  }
  
  console.log('✓ Subscribed to doc2');
  
  if (!doc2.data) {
    doc2.create({
      title: 'Example Document 2',
      items: ['First item', 'Second item'],
      counter: 0
    });
    console.log('Created doc2 with initial data');
  } else {
    console.log('Doc2 already exists:', doc2.data);
  }
});

// Listen for real-time updates (these will come from other tabs too!)
doc1.on('op', function(op, source) {
  console.log('📝 Doc1 operation received:', op, 'from source:', source);
  console.log('📄 Doc1 current data:', doc1.data);
});

doc2.on('op', function(op, source) {
  console.log('📝 Doc2 operation received:', op, 'from source:', source);
  console.log('📄 Doc2 current data:', doc2.data);
});

// Example operations to demonstrate real-time sync
setTimeout(function() {
  console.log('\n🔄 Performing example operations...');
  
  // Modify doc1
  if (doc1.data) {
    doc1.submitOp([{
      p: ['content'],
      oi: 'This document was updated from Tab ' + Math.floor(Math.random() * 1000)
    }]);
    console.log('Updated doc1 content');
  }
  
  // Modify doc2
  if (doc2.data) {
    doc2.submitOp([{
      p: ['counter'],
      na: 1 // Number add operation
    }]);
    console.log('Incremented doc2 counter');
    
    // Add a new item to the list
    doc2.submitOp([{
      p: ['items', doc2.data.items.length],
      li: 'New item from Tab ' + Math.floor(Math.random() * 1000)
    }]);
    console.log('Added new item to doc2');
  }
}, 2000);

// Demonstrate bulk operations
setTimeout(function() {
  console.log('\n📦 Testing bulk operations...');
  
  connection.getBulk('documents', ['example-doc-1', 'example-doc-2'], function(error, docs) {
    if (error) {
      console.error('Bulk load failed:', error);
      return;
    }
    
    console.log('✓ Bulk loaded', docs.length, 'documents');
    docs.forEach(function(doc, index) {
      console.log('  Doc', index + 1 + ':', doc.id, 'version:', doc.version);
    });
  });
}, 4000);

// Demonstrate auto-flush control
setTimeout(function() {
  console.log('\n⚡ Testing auto-flush control...');
  
  console.log('Current auto-flush:', connection.isAutoFlush());
  console.log('Pending writes:', connection.hasPendingWrites());
  console.log('Queue size:', connection.getWriteQueueSize());
  
  // Disable auto-flush for batch operations
  connection.setAutoFlush(false);
  console.log('Disabled auto-flush');
  
  // Queue some operations
  connection.putDoc(doc1);
  connection.putDoc(doc2);
  
  console.log('Queued documents, pending writes:', connection.hasPendingWrites());
  console.log('Queue size:', connection.getWriteQueueSize());
  
  // Flush manually
  connection.flushWrites(function(error) {
    if (error) {
      console.error('Flush failed:', error);
    } else {
      console.log('✓ Manual flush completed');
    }
    
    // Re-enable auto-flush
    connection.setAutoFlush(true);
    console.log('Re-enabled auto-flush');
  });
}, 6000);

// Connection statistics
setInterval(function() {
  if (ShareDB.proxy.isProxyConnection(connection)) {
    var stats = connection.getStats();
    console.log('\n📊 Proxy Connection Stats:');
    console.log('  State:', stats.state);
    console.log('  Cached docs:', stats.cachedDocuments);
    console.log('  Message broker ready:', stats.messageBroker.isReady);
    console.log('  Pending callbacks:', stats.messageBroker.pendingCallbacks);
  }
}, 10000);

// Instructions for multi-tab testing
console.log('\n🎯 Multi-tab Testing Instructions:');
console.log('1. Open this same page in multiple browser tabs');
console.log('2. Watch the console in each tab - operations will sync in real-time');
console.log('3. All tabs share the same SharedWorker connection and DurableStore');
console.log('4. No IndexedDB conflicts occur between tabs');
console.log('5. Changes made in one tab instantly appear in all other tabs');

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', function() {
    console.log('Closing connection...');
    connection.close();
  });
}