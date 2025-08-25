# DurableStore Implementation Guide

This guide covers ShareDB's DurableStore system for offline-first data persistence in web applications. DurableStore provides automatic operation queuing, document synchronization, and conflict resolution using browser IndexedDB storage.

## Overview of the Architecture

The DurableStore system provides offline-first data persistence for ShareDB documents through a layered architecture. At its core, you inject a storage implementation into the DurableStore, which handles document synchronization, operation queuing, and conflict resolution.

For web applications, ShareDB includes a built-in IndexedDbStorage implementation that uses the browser's IndexedDB API. This allows your application to work offline and sync changes when connectivity returns.

## Basic Setup

The simplest way to enable DurableStore is to use the built-in IndexedDB storage:

```javascript
import ShareDB from 'sharedb/lib/client';

// Create ShareDB connection
const connection = new ShareDB.Connection('ws://localhost:8080');

// Enable DurableStore with default IndexedDB storage
connection.useDurableStore();
```

This automatically creates an IndexedDB database named `sharedb` and enables offline persistence for all documents and operations.

## Custom IndexedDB Configuration

You can customize the IndexedDB storage configuration:

```javascript
import ShareDB from 'sharedb/lib/client';
import IndexedDbStorage from 'sharedb/lib/client/storage/indexed-db-storage';

// Create custom IndexedDB storage
const storage = new IndexedDbStorage({
  databaseName: 'my_app_v1',
  version: 1,
  debug: true
});

// Initialize storage before use
storage.initialize((err, inventory) => {
  if (err) {
    console.error('Storage initialization failed:', err);
    return;
  }
  
  console.log('Storage initialized with inventory:', inventory);
  
  // Create ShareDB connection
  const connection = new ShareDB.Connection('ws://localhost:8080');
  
  // Enable DurableStore with custom storage
  connection.useDurableStore({ storage });
});
```

## Document Lifecycle with DurableStore

When DurableStore is enabled, document operations follow this lifecycle:

1. **Local Operation**: Operations are immediately applied locally and stored in IndexedDB
2. **Queue for Sync**: Operations are queued for synchronization when online
3. **Server Sync**: When connected, operations are sent to the server
4. **Conflict Resolution**: Server responses trigger operational transform for conflict resolution
5. **Storage Update**: Final resolved state is persisted to IndexedDB

Here's an example of working with documents:

```javascript
// Get a document (works offline)
const doc = connection.get('posts', 'my-post-id');

doc.subscribe((err) => {
  if (err) {
    console.error('Failed to subscribe:', err);
    return;
  }

  // Create document if it doesn't exist
  if (!doc.data) {
    const initialData = {
      title: 'My Post',
      content: 'Hello world!',
      createdAt: new Date().toISOString()
    };
    
    doc.create(initialData, (createErr) => {
      if (createErr) {
        console.error('Failed to create document:', createErr);
      } else {
        console.log('Document created:', doc.data);
      }
    });
  }
});

// Update document (queued for sync when offline)
function updatePost(title, content) {
  const ops = [
    { p: ['title'], od: doc.data.title, oi: title },
    { p: ['content'], od: doc.data.content, oi: content },
    { p: ['updatedAt'], oi: new Date().toISOString() }
  ];
  
  doc.submitOp(ops, (err) => {
    if (err) {
      console.error('Failed to update document:', err);
    } else {
      console.log('Document updated:', doc.data);
    }
  });
}
```

## Query Support

DurableStore supports queries and automatically syncs query results:

```javascript
// Create a query (works offline with cached data)
const query = connection.createQuery('posts', {
  author: 'user123'
});

query.subscribe((err) => {
  if (err) {
    console.error('Query subscription failed:', err);
    return;
  }
  
  console.log('Query results:', query.results);
  
  // Results automatically update when documents change
  query.on('changed', (results) => {
    console.log('Query updated:', results);
  });
});
```

## Encryption Support

DurableStore supports optional encryption callbacks for sensitive data:

```javascript
import CryptoJS from 'crypto-js';

const encryptionKey = 'your-secret-key';

function encryptData(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), encryptionKey).toString();
}

function decryptData(encryptedData) {
  const bytes = CryptoJS.AES.decrypt(encryptedData, encryptionKey);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// Enable DurableStore with encryption
connection.useDurableStore({
  encrypt: encryptData,
  decrypt: decryptData
});
```

## Connection States and Offline Handling

DurableStore automatically handles connection state changes:

```javascript
// Monitor connection state
connection.on('connected', () => {
  console.log('Connected - syncing queued operations');
});

connection.on('disconnected', () => {
  console.log('Disconnected - operations will be queued');
});

// Check if operations are pending sync
connection.on('syncComplete', () => {
  console.log('All queued operations have been synced');
});

// Handle sync errors
connection.on('syncError', (err) => {
  console.error('Sync error:', err);
});
```

## Multi-tab Coordination

For applications that may run in multiple browser tabs, ShareDB provides a ProxyConnection system that coordinates access to shared storage:

```javascript
import ProxyConnection from 'sharedb/lib/client/proxy-connection';

// Create proxy connection for multi-tab safety
const proxyConnection = new ProxyConnection('ws://localhost:8080');

// Enable DurableStore on the proxy
proxyConnection.useDurableStore();

// Use proxy connection same as regular connection
const doc = proxyConnection.get('posts', 'shared-doc');
```

The ProxyConnection uses a MessageBroker system to coordinate between tabs, preventing storage conflicts and ensuring consistent synchronization across all open tabs.

## Storage Interface

If you need to implement custom storage (for specialized use cases), implement the storage interface used by IndexedDbStorage:

```javascript
class CustomStorage {
  initialize(callback) {
    // Initialize storage system
    // callback(err, inventory)
  }
  
  getAllDocs(callback) {
    // Return all stored documents
    // callback(err, docs)
  }
  
  getDoc(collection, id, callback) {
    // Get specific document
    // callback(err, doc)
  }
  
  saveDoc(collection, id, data, callback) {
    // Save document
    // callback(err)
  }
  
  deleteDoc(collection, id, callback) {
    // Delete document
    // callback(err)
  }
  
  getAllOps(callback) {
    // Return all queued operations
    // callback(err, ops)
  }
  
  saveOp(op, callback) {
    // Save operation to queue
    // callback(err)
  }
  
  deleteOp(opId, callback) {
    // Remove operation from queue
    // callback(err)
  }
  
  close(callback) {
    // Clean up storage
    // callback(err)
  }
}
```

## Performance Considerations

- **IndexedDB Limits**: Be aware of browser storage quotas (typically 50% of available disk space)
- **Operation Queue**: Large operation queues can impact startup performance
- **Sync Strategy**: Consider implementing selective sync for large datasets
- **Memory Usage**: Large documents are kept in memory when subscribed

## Error Handling

Common error scenarios to handle:

```javascript
// Storage quota exceeded
storage.on('quotaExceeded', () => {
  console.warn('Storage quota exceeded - consider cleanup');
});

// Sync conflicts
doc.on('error', (err) => {
  if (err.code === 4016) { // Op already submitted
    console.log('Operation conflict resolved automatically');
  } else {
    console.error('Document error:', err);
  }
});

// Storage corruption
connection.on('storageError', (err) => {
  console.error('Storage error - may need to clear cache:', err);
});
```

## React Native and Mobile

For React Native applications using SQLite storage, see the [@shaxpir/sharedb-storage-expo-sqlite](https://github.com/shaxpir/sharedb-storage-expo-sqlite) package which provides equivalent functionality with SQLite persistence, advanced schema strategies, and mobile-optimized performance.

## Conclusion

DurableStore provides a robust offline-first architecture for web applications using ShareDB. The built-in IndexedDB storage handles most use cases automatically, while the pluggable architecture allows for custom storage implementations when needed.

The system gracefully handles network interruptions, queues operations for later sync, and resolves conflicts using operational transforms - providing a seamless user experience regardless of connectivity state.