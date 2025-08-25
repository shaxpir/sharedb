# ShareDB Bulk Operations API Reference

ShareDB provides efficient bulk operations for loading and writing multiple documents in single operations, significantly improving performance for applications that work with multiple documents simultaneously.

## Table of Contents

- [Overview](#overview)
- [Connection-Level API](#connection-level-api)
- [Bulk Reading](#bulk-reading)
- [Batch Writing Control](#batch-writing-control)
- [Usage Examples](#usage-examples)
- [Performance Benefits](#performance-benefits)
- [TypeScript Support](#typescript-support)

## Overview

The bulk operations API provides two main capabilities:

1. **Bulk Reading** - Load multiple documents by ID in a single operation
2. **Batch Writing Control** - Control when document writes are flushed to storage

Both operations are designed to be:
- **Cache-aware** - Leverage existing document cache for optimal performance
- **Storage-optimized** - Generate efficient storage queries when possible
- **Backward-compatible** - Work alongside existing ShareDB APIs

## Connection-Level API

All bulk operations are accessed through the Connection object, providing a clean, consistent interface.

### Bulk Reading

#### `connection.getBulk(collection, ids, callback)`

Load multiple documents by ID in a single operation.

**Parameters:**
- `collection` (string) - Collection name
- `ids` (string[]) - Array of document IDs to retrieve
- `callback` (function) - Callback function `(error, docs) => void`

**Returns:**
- Array of ShareDB Doc objects in the same order as requested IDs
- Documents are cached and have full ShareDB lifecycle (events, operations, etc.)

**Example:**
```javascript
connection.getBulk('posts', ['post1', 'post2', 'post3'], function(err, docs) {
  if (err) throw err;
  console.log('Loaded', docs.length, 'posts');
  
  // Each doc is a full ShareDB document
  docs.forEach(function(doc) {
    console.log('Post:', doc.id, 'Title:', doc.data?.title);
    
    // Can subscribe, modify, etc.
    doc.subscribe();
    doc.on('op', handleUpdate);
  });
});
```

### Batch Writing Control

#### `connection.setAutoFlush(enabled)`

Control automatic flushing of document writes to storage.

**Parameters:**
- `enabled` (boolean) - Whether to enable automatic flushing

When `enabled = false`:
- Documents are queued but not automatically written to storage
- Allows accumulating multiple documents before writing
- Must call `flushWrites()` to persist queued documents

**Example:**
```javascript
// Disable auto-flush for controlled batching
connection.setAutoFlush(false);

// Add documents to queue without flushing
connection.putDoc(doc1);
connection.putDoc(doc2);
connection.putDoc(doc3);

// Manually flush when ready
connection.flushWrites(function(err) {
  console.log('Batch written to storage');
  
  // Re-enable auto-flush
  connection.setAutoFlush(true);
});
```

#### `connection.isAutoFlush()`

Check if auto-flush is currently enabled.

**Returns:**
- `boolean` - True if auto-flush is enabled

#### `connection.putDoc(doc, callback?)`

Add a document to the write queue.

**Parameters:**
- `doc` (Doc) - ShareDB document to write
- `callback` (function, optional) - Callback function `(error) => void`

**Behavior:**
- If auto-flush enabled: triggers automatic write to storage
- If auto-flush disabled: queues document without writing

#### `connection.putDocs(docs, callback?)`

Add multiple documents to the write queue.

**Parameters:**
- `docs` (Doc[]) - Array of ShareDB documents to write
- `callback` (function, optional) - Callback function `(error) => void`

#### `connection.putDocsBulk(docs, callback?)`

Bulk write multiple documents with immediate flush.

**Parameters:**
- `docs` (Doc[]) - Array of ShareDB documents to write
- `callback` (function, optional) - Callback function `(error) => void`

This is a convenience method that:
1. Temporarily disables auto-flush
2. Adds all documents to queue
3. Flushes immediately
4. Restores original auto-flush setting

#### `connection.flushWrites(callback?)`

Force flush any pending writes to storage.

**Parameters:**
- `callback` (function, optional) - Callback function `(error) => void`

#### `connection.getWriteQueueSize()`

Get the current number of documents waiting to be written.

**Returns:**
- `number` - Number of documents in write queue

#### `connection.hasPendingWrites()`

Check if there are documents waiting to be written.

**Returns:**
- `boolean` - True if there are pending writes

## Usage Examples

### Data Import

```javascript
async function importDocuments(importData) {
  // Disable auto-flush for efficient import
  connection.setAutoFlush(false);
  
  // Create documents from import data
  const docs = importData.map(item => {
    const doc = connection.get('documents', item.id);
    doc.create(item.data);
    return doc;
  });
  
  // Add all documents to queue
  connection.putDocs(docs, function(err) {
    if (err) throw err;
    
    console.log('Import queued:', docs.length, 'documents');
    console.log('Queue size:', connection.getWriteQueueSize());
    
    // Validate import...
    validateImport(docs).then(isValid => {
      if (isValid) {
        // Commit import
        connection.flushWrites(function() {
          console.log('Import committed successfully');
          connection.setAutoFlush(true);
        });
      } else {
        // Cancel import (documents remain queued)
        console.log('Import validation failed');
        connection.setAutoFlush(true); // Will flush on next write
      }
    });
  });
}
```

### Periodic Auto-Save

```javascript
function setupAutoSave() {
  // Disable auto-flush for controlled saving
  connection.setAutoFlush(false);
  
  // Auto-save every 30 seconds
  setInterval(function() {
    if (connection.hasPendingWrites()) {
      const queueSize = connection.getWriteQueueSize();
      console.log('Auto-saving', queueSize, 'pending changes...');
      
      connection.flushWrites(function(err) {
        if (err) {
          console.error('Auto-save failed:', err);
        } else {
          console.log('Auto-save completed');
        }
      });
    }
  }, 30000);
}

// User makes changes throughout the session
function onUserEdit(doc) {
  // Documents are queued but not immediately saved
  connection.putDoc(doc);
  console.log('Change queued for auto-save');
}
```

### Atomic Operations

```javascript
function createUserWithProfile(userData, profileData) {
  connection.setAutoFlush(false);
  
  const userDoc = connection.get('users', userData.id);
  const profileDoc = connection.get('profiles', userData.id);
  
  userDoc.create(userData);
  profileDoc.create({ ...profileData, userId: userData.id });
  
  // Add both documents as atomic operation
  connection.putDocs([userDoc, profileDoc], function(err) {
    if (err) {
      console.error('Transaction preparation failed:', err);
      connection.setAutoFlush(true);
      return;
    }
    
    console.log('Transaction prepared, validating...');
    
    // Validate transaction
    if (isValidTransaction(userDoc, profileDoc)) {
      // Commit transaction
      connection.flushWrites(function() {
        console.log('User and profile created successfully');
        connection.setAutoFlush(true);
      });
    } else {
      console.log('Transaction validation failed');
      connection.setAutoFlush(true); // Documents remain queued
    }
  });
}
```

### Dashboard Loading

```javascript
function loadDashboard(userId) {
  // First get user document
  const userDoc = connection.get('users', userId);
  
  userDoc.fetch(function(err) {
    if (err || !userDoc.data) return;
    
    // Get user's project and document IDs
    const projectIds = userDoc.data.projectIds || [];
    const recentDocIds = userDoc.data.recentDocuments || [];
    
    // Load all user's projects in bulk
    connection.getBulk('projects', projectIds, function(err, projects) {
      if (err) throw err;
      
      console.log('Loaded', projects.length, 'projects');
      
      // Subscribe to all projects for real-time updates
      projects.forEach(project => {
        project.subscribe();
        project.on('op', updateProjectUI);
      });
      
      // Load recent documents in bulk
      connection.getBulk('documents', recentDocIds, function(err, docs) {
        if (err) throw err;
        
        console.log('Loaded', docs.length, 'recent documents');
        
        // Dashboard fully loaded
        showDashboard(userDoc, projects, docs);
      });
    });
  });
}
```

## Performance Benefits

### Bulk Reading Benefits

- **Single Storage Query**: Instead of N individual database queries, bulk reading generates a single optimized query
- **Cache Efficiency**: Leverages existing document cache, only fetching uncached documents
- **Network Optimization**: Fewer round-trips between client and storage
- **SQL Index Usage**: CollectionPerTableStrategy can leverage indexed columns for optimal performance

**Performance Comparison:**
```javascript
// Individual loading: N database queries
const docs = [];
for (const id of ids) {
  const doc = connection.get('collection', id);
  await new Promise(resolve => doc.fetch(resolve));
  docs.push(doc);
}

// Bulk loading: 1 optimized database query
connection.getBulk('collection', ids, (err, docs) => {
  // All documents loaded in single operation
});
```

### Batch Writing Benefits

- **Reduced I/O**: Multiple documents written in single storage operation
- **Transaction-like Behavior**: Group related document changes
- **Timing Control**: Write expensive operations when optimal (e.g., during idle time)
- **Offline Optimization**: Accumulate changes while offline, flush on reconnection

### Storage-Specific Optimizations

**SQLite Storage (CollectionPerTableStrategy):**
- Generates `SELECT ... WHERE id IN (?, ?, ?)` queries
- Leverages indexed columns for optimal performance
- Minimizes database connection overhead

**IndexedDB Storage:**
- Uses IndexedDB transactions for efficient bulk operations
- Reduces browser I/O overhead
- Maintains encryption/decryption efficiency

**In-Memory Storage:**
- Direct object access for maximum speed
- Minimal overhead for testing and development

## TypeScript Support

Full TypeScript definitions are provided for all bulk operations:

```typescript
interface Connection {
  // Bulk reading
  getBulk(collection: string, ids: string[], callback: (error: Error | null, docs: Doc[]) => void): void;
  
  // Batch writing control
  setAutoFlush(enabled: boolean): void;
  isAutoFlush(): boolean;
  putDoc(doc: Doc, callback?: (error: Error | null) => void): void;
  putDocs(docs: Doc[], callback?: (error: Error | null) => void): void;
  putDocsBulk(docs: Doc[], callback?: (error: Error | null) => void): void;
  flushWrites(callback?: (error: Error | null) => void): void;
  getWriteQueueSize(): number;
  hasPendingWrites(): boolean;
}
```

See [TYPESCRIPT.md](./TYPESCRIPT.md) for complete TypeScript usage examples.

## Integration with Existing APIs

Bulk operations work seamlessly with existing ShareDB features:

- **Queries**: Use bulk loading to efficiently load query results
- **Presence**: Bulk-loaded documents support presence subscriptions
- **Middleware**: All bulk operations go through existing middleware hooks
- **OT Types**: Works with all operational transform types (JSON0, Rich Text, etc.)
- **Projections**: Respects field projections when loading documents

## Error Handling

Bulk operations provide consistent error handling:

```javascript
connection.getBulk('collection', ids, function(err, docs) {
  if (err) {
    console.error('Bulk loading failed:', err.message);
    return;
  }
  
  // docs array is guaranteed to be valid
  console.log('Successfully loaded', docs.length, 'documents');
});

connection.putDocsBulk(docs, function(err) {
  if (err) {
    console.error('Bulk writing failed:', err.message);
    // Documents may be partially written
    return;
  }
  
  console.log('All documents written successfully');
});
```

## Migration Guide

### From Individual Operations

**Before:**
```javascript
// Individual document loading
const promises = ids.map(id => {
  return new Promise((resolve, reject) => {
    const doc = connection.get('collection', id);
    doc.fetch((err) => err ? reject(err) : resolve(doc));
  });
});

const docs = await Promise.all(promises);
```

**After:**
```javascript
// Bulk document loading
connection.getBulk('collection', ids, function(err, docs) {
  if (err) throw err;
  // All documents loaded efficiently
});
```

### Adding Batch Control

**Before:**
```javascript
// Documents written immediately
docs.forEach(doc => {
  durableStore.putDoc(doc); // Immediate write
});
```

**After:**
```javascript
// Controlled batch writing
connection.setAutoFlush(false);
docs.forEach(doc => connection.putDoc(doc)); // Queued
connection.flushWrites(() => console.log('Batch complete'));
connection.setAutoFlush(true);

// Or use convenience method
connection.putDocsBulk(docs, () => console.log('Bulk complete'));
```

---

For more examples and advanced usage patterns, see:
- [examples/bulk-loading-example.js](./examples/bulk-loading-example.js)
- [examples/connection-batch-control-example.js](./examples/connection-batch-control-example.js)
- [TYPESCRIPT.md](./TYPESCRIPT.md) - TypeScript usage guide
- [OT_TYPES_GUIDE.md](./OT_TYPES_GUIDE.md) - Operational transform types reference