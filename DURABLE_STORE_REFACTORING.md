# DurableStore Storage Refactoring Plan

## Current State Analysis

### Recent Changes (Commit 3da195f)
- Extracted IndexedDB-specific logic from `DurableStore` into `IndexedDbStorage` module
- Created `ExpoSqliteStorage` module for React Native/SQLite support
- DurableStore now attempts to be storage-agnostic via strategy pattern

### Issues Identified

#### 1. Critical Bugs
- **Line 43 in durable-store.js**: Variable hoisting bug - `typeof (storageEngine)` checked before `storageEngine` is declared
- **Line 51 in expo-sqlite-storage.js**: References undefined `options` instead of `this` for database configuration
- **Line 47 in expo-sqlite-storage.js**: Uses `window.performance.now()` which doesn't exist in React Native

#### 2. Architecture Issues
- DurableStore still has hard dependencies on storage implementations (requires them internally)
- Storage selection via string is tightly coupled
- No testing-friendly in-memory storage option
- Connection doesn't properly pass storage configuration

## Refactoring Goals

1. **Dependency Injection**: DurableStore should accept a storage instance, not instantiate it
2. **Testing Support**: Create InMemoryStorage for unit tests
3. **Clean Separation**: Remove all storage implementation dependencies from durable-store.js
4. **Proper Integration**: Connection should pass storage instance through options

## Implementation Checklist

### Phase 1: Core Refactoring
- [x] Fix variable declaration bug in DurableStore constructor (line 43)
- [x] Refactor DurableStore constructor to accept `(storage, options)` instead of just `(options)`
- [x] Remove all require() statements for storage implementations from durable-store.js
- [x] Update DurableStore to use injected storage instance

### Phase 2: Storage Implementations
- [x] Create InMemoryStorage implementation in `lib/client/storage/in-memory-storage.js`
  - [x] Implement same interface as IndexedDbStorage
  - [x] Store data in memory using simple JS objects
  - [x] Support all required methods: initialize, ensureReady, readRecord, writeRecords, etc.
- [x] Fix ExpoSqliteStorage bugs:
  - [x] Replace `window.performance.now()` with React Native compatible timing
  - [x] Fix undefined `options` reference (should be `this`)
  - [x] Fix ES3 compatibility (arrow functions, const/let, template literals)
  - [x] Fix variable scoping issues in writeRecords
  - [x] Fix SQL injection vulnerabilities with parameterized queries
  - [x] Add validateStoreName() method for table name validation
  - [ ] Complete SQL implementation with proper async/await
  - [ ] Fix SQL syntax and promises

### Phase 3: Integration
- [x] Update Connection to accept storage instance in options
  - [x] Connection options should have `durableStore.storage` field
  - [x] Pass storage instance when creating DurableStore
- [ ] Update any existing Connection usage examples/tests

### Phase 4: Testing
- [ ] Create/update tests using InMemoryStorage
- [ ] Verify all three storage implementations work correctly
- [ ] Test storage abstraction interface consistency

## Storage Interface Contract

All storage implementations must provide these methods:

```javascript
// Core lifecycle
initialize(onReadyCallback) // Async initialization, calls onReadyCallback with inventory
ensureReady() // Throws if not ready

// Read operations
readRecord(store, id, callback) // Read single record
readAllRecords(store, callback) // Read all records from a store

// Write operations
writeRecords(records, callback) // Batch write records (docs and/or meta)

// Required properties
ready // Boolean flag indicating initialization complete
debug // Boolean for logging
```

## File Structure

```
lib/client/
├── durable-store.js                    # Core DurableStore (storage-agnostic)
└── storage/
    ├── indexed-db-storage.js           # Browser IndexedDB implementation
    ├── expo-sqlite-storage.js          # React Native SQLite implementation
    └── in-memory-storage.js            # Testing in-memory implementation
```

## Connection Usage Pattern

After refactoring, the usage should look like:

```javascript
// Browser usage
var IndexedDbStorage = require('sharedb/lib/client/storage/indexed-db-storage');
var storage = new IndexedDbStorage({
  namespace: 'myapp',
  useEncryption: true,
  encryptionCallback: encrypt,
  decryptionCallback: decrypt
});

var connection = new ShareDB.Connection(socket, {
  durableStore: {
    storage: storage,
    maxBatchSize: 20,
    extVersionDecoder: myDecoder
  }
});

// React Native usage
var ExpoSqliteStorage = require('sharedb/lib/client/storage/expo-sqlite-storage');
var storage = new ExpoSqliteStorage({
  dbFileName: 'sharedb.db',
  namespace: 'myapp'
});

var connection = new ShareDB.Connection(socket, {
  durableStore: {
    storage: storage,
    maxBatchSize: 20
  }
});

// Testing usage
var InMemoryStorage = require('sharedb/lib/client/storage/in-memory-storage');
var storage = new InMemoryStorage();

var connection = new ShareDB.Connection(socket, {
  durableStore: {
    storage: storage
  }
});
```

## Notes

- Maintain ES3 compatibility (no arrow functions, const/let, etc.)
- Follow existing code patterns and conventions
- Storage implementations should handle their own encryption/decryption
- All async operations should use callbacks, not promises (ShareDB convention)
- Timing: Consider using `Date.now()` for cross-platform compatibility
- **Make incremental git commits throughout progress** - Commit after significant milestones

## Phase 5: Schema Strategy Architecture (New)

### Motivation
The current ExpoSqliteStorage uses a fixed schema with two tables ('meta' and 'docs'). This limits flexibility for production use cases that need:
- Performance optimization through collection-specific tables
- Granular field-level encryption
- SQL indexes on specific JSON fields
- Custom query optimization

### Schema Strategy Interface
Each schema strategy must implement these methods:

```javascript
// Core schema operations
initializeSchema(db, callback) // Create tables, indexes
validateSchema(db, callback) // Check if schema is valid
migrateSchema(db, fromVersion, toVersion, callback) // Handle migrations

// Storage operations  
writeRecords(db, records, callback) // Write with strategy-specific logic
readRecord(db, collection, id, callback) // Read with strategy-specific logic
deleteRecord(db, collection, id, callback) // Delete with strategy-specific logic
readAllRecords(db, collection, callback) // Read all records in collection

// Encryption strategy
shouldEncryptField(collection, fieldPath) // Determine field-level encryption
encryptRecord(record, collection) // Apply encryption strategy
decryptRecord(record, collection) // Apply decryption strategy

// Query optimization
createIndexes(db, collection, callback) // Create collection-specific indexes
optimizeQuery(collection, query) // Transform query for optimization
```

### Example Strategies

#### DefaultSchemaStrategy
- Single 'docs' table for all collections
- Single 'meta' table for metadata
- **Inventory as JSON**: Single JSON document in meta table
- All-or-nothing encryption (entire payload)
- Suitable for: Small to medium applications, backward compatibility

#### CollectionPerTableStrategy  
- Separate table for each collection
- **Inventory as table**: Dedicated inventory table with indexes
  - Each row represents one document
  - Columns: collection, doc_id, version, updated_at
  - Indexed for fast queries by collection or update time
- Custom indexes per collection on JSON fields
- Field-level encryption options per collection
- Optimized queries per collection
- Suitable for: Large-scale applications, better query performance

### Inventory Representation Comparison

| Aspect | JSON (DefaultStrategy) | Table (CollectionPerTableStrategy) |
|--------|------------------------|-------------------------------------|
| Storage | Single JSON document | Relational table with indexes |
| Update Performance | O(n) - rewrite entire doc | O(1) - single row update |
| Query Performance | Load entire inventory | SQL queries with WHERE clauses |
| Scalability | Limited (large JSON) | Excellent (indexed table) |
| Memory Usage | Entire inventory in memory | Stream results as needed |
| Atomic Updates | Complex (read-modify-write) | Simple (SQL INSERT/UPDATE) |

### Implementation Plan
1. ✅ Define SchemaStrategy interface
2. ✅ Extract current schema logic into DefaultSchemaStrategy
3. ✅ Create CollectionPerTableStrategy with table-based inventory
4. ⏳ Update ExpoSqliteStorage to accept strategy via options
5. ⏳ Add migration support between strategies

### Usage Examples

```javascript
// Using DefaultSchemaStrategy (backward compatible)
var DefaultSchemaStrategy = require('sharedb/lib/client/storage/schema/default-schema-strategy');
var schemaStrategy = new DefaultSchemaStrategy({
  useEncryption: true,
  encryptionCallback: encrypt,
  decryptionCallback: decrypt
});

var storage = new ExpoSqliteStorage({
  dbFileName: 'sharedb.db',
  schemaStrategy: schemaStrategy
});

// Using CollectionPerTableStrategy (optimized)
var CollectionPerTableStrategy = require('sharedb/lib/client/storage/schema/collection-per-table-strategy');
var schemaStrategy = new CollectionPerTableStrategy({
  collectionConfig: {
    'users': {
      indexes: ['email', 'username'],
      encryptedFields: ['password', 'personalInfo']
    },
    'posts': {
      indexes: ['authorId', 'createdAt', 'tags'],
      encryptedFields: []
    }
  },
  useEncryption: true,
  encryptionCallback: encrypt,
  decryptionCallback: decrypt
});

var storage = new ExpoSqliteStorage({
  dbFileName: 'sharedb.db',
  schemaStrategy: schemaStrategy
});
```

## Progress Tracking

This document will be updated as work progresses. Current status:
- Planning: ✅ Complete
- Phase 1 (Core Refactoring): ✅ Complete
- Phase 2 (Storage Implementations): ✅ Complete (except SQLite async details)
- Phase 3 (Integration): ✅ Complete
- Phase 4 (Testing): ⏳ Pending
- Phase 5 (Schema Strategies): 🔄 In Progress (architecture complete, integration pending)

## Commits Made
1. `e423848` - Add refactoring plan document
2. `971e9c2` - Refactor DurableStore to use dependency injection for storage
3. `4340b86` - Fix bugs in ExpoSqliteStorage implementation
4. `e88cfaf` - Update refactoring plan with progress
5. `c7cd962` - Fix SQL injection vulnerabilities in ExpoSqliteStorage
6. `146661b` - Add pluggable schema strategy architecture for ExpoSqliteStorage