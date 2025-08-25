# Connection Pooling Guide for ShareDB

This guide explains how to use connection pooling with ShareDB's ExpoSqliteStorage to improve performance and prevent database locking issues in multi-operation scenarios.

## Overview

Connection pooling helps manage SQLite database connections efficiently by:

- **Preventing Database Locks**: Multiple operations use separate connections
- **Improving Concurrency**: Read operations can run parallel to writes
- **Resource Management**: Automatic connection lifecycle management
- **Performance Optimization**: Reduced connection setup overhead

## Architecture

ShareDB's connection pooling uses a **dependency injection pattern** where you provide a connection pool that implements the standard `withConnection(operation, callback)` interface.

### Supported Pool Types

1. **StandardSQLiteConnectionPool** - Built-in pool using `generic-pool`
2. **Your Custom DatabaseConnectionPool** - Your existing pool implementation
3. **Any Compatible Pool** - Any object with `withConnection()` method

## Installation

```bash
npm install generic-pool
```

## Basic Usage

### Option 1: Using Built-in StandardSQLiteConnectionPool

```javascript
const { ExpoSqliteStorage } = require('sharedb/lib/client/storage/expo-sqlite-storage');
const { StandardSQLiteConnectionPool } = require('sharedb/lib/client/storage/connection-pool/sqlite-connection-pool');
const { DatabaseServiceInit } = require('./DatabaseServiceInit');

// Create connection pool
const connectionPool = new StandardSQLiteConnectionPool({
  createConnection: () => DatabaseServiceInit.init(), // Your DB factory
  maxConnections: 5,
  minConnections: 2,
  acquireTimeout: 5000,    // 5 seconds
  idleTimeout: 30000,      // 30 seconds
  debug: true
});

// Create storage with injected pool
const storage = new ExpoSqliteStorage({
  database: await DatabaseServiceInit.init(),  // Main connection
  connectionPool: connectionPool,              // Injected pool
  schemaPrefix: 'userdata',
  enableCrossDbQueries: true,
  debug: true
});
```

### Option 2: Using Your Existing DatabaseConnectionPool

```javascript
const { dbConnectionPool } = require('./DatabaseConnectionPool');

const storage = new ExpoSqliteStorage({
  database: await DatabaseServiceInit.init(),
  connectionPool: dbConnectionPool,        // Your existing pool!
  schemaPrefix: 'userdata',
  enableCrossDbQueries: true
});
```

### Option 3: No Connection Pool (Default Behavior)

```javascript
const storage = new ExpoSqliteStorage({
  database: await DatabaseServiceInit.init(),
  schemaPrefix: 'userdata',
  // No connectionPool = single connection used for everything
});
```

## When Connection Pool is Used

The storage automatically uses the connection pool for operations that benefit from connection isolation:

### Automatic Pool Usage:
- **Cross-Database Queries** (`executeCrossDbQuery`) - Always uses pool if available
- **Bulk Operations** (future) - Large batch reads/writes
- **Analytics Queries** (future) - Long-running reporting queries
- **Schema Migrations** (future) - DDL operations

### Regular Operations:
- **Single Document Reads/Writes** - Use main connection for efficiency
- **Small Batch Operations** - Use main connection unless specified otherwise

## Configuration Options

### StandardSQLiteConnectionPool Options

```javascript
const pool = new StandardSQLiteConnectionPool({
  // Required: Database factory function
  createConnection: () => DatabaseServiceInit.init(),
  
  // Optional: Connection lifecycle
  destroyConnection: (conn) => conn.closeAsync(),
  validateConnection: (conn) => conn.getFirstAsync('SELECT 1'),
  
  // Pool sizing
  maxConnections: 5,     // Maximum concurrent connections
  minConnections: 2,     // Minimum idle connections
  
  // Timeouts (milliseconds)
  acquireTimeout: 5000,      // Time to wait for connection
  createTimeout: 10000,      // Time to create new connection
  destroyTimeout: 5000,      // Time to close connection
  idleTimeout: 30000,        // Idle connection lifetime
  reapInterval: 1000,        // Cleanup check frequency
  evictionInterval: 5000,    // Invalid connection cleanup
  
  // Connection testing
  testOnBorrow: true,    // Validate before giving to operation
  testOnReturn: true,    // Validate when returning to pool
  
  // Debugging
  debug: true           // Enable detailed logging
});
```

### ExpoSqliteStorage with Pool Options

```javascript
const storage = new ExpoSqliteStorage({
  // Database connection
  database: db,                    // Pre-initialized main connection
  
  // Connection pool (injected dependency)
  connectionPool: pool,           // Any pool with withConnection() method
  
  // Dual-database options  
  schemaPrefix: 'userdata',      // Schema prefix for attached DB
  collectionMapping: mapFn,      // Collection to table mapping
  enableCrossDbQueries: true,    // Enable JOIN operations
  
  // Standard ShareDB options
  namespace: 'myapp',
  useEncryption: true,
  debug: true
});
```

## Advanced Examples

### Custom Connection Pool Interface

```javascript
// Your custom pool only needs to implement withConnection()
class CustomPool {
  constructor(options) {
    this.connections = [];
    this.options = options;
  }
  
  withConnection(operation, callback) {
    const conn = this.getConnection();
    
    const promise = operation(conn);
    if (promise && typeof promise.then === 'function') {
      promise.then(result => {
        this.releaseConnection(conn);
        callback(null, result);
      }).catch(error => {
        this.releaseConnection(conn);
        callback(error);
      });
    } else {
      this.releaseConnection(conn);
      callback(null, promise);
    }
  }
  
  getConnection() { /* your logic */ }
  releaseConnection(conn) { /* your logic */ }
}

// Use with ShareDB
const storage = new ExpoSqliteStorage({
  database: db,
  connectionPool: new CustomPool(options)
});
```

### Integration with DuiDuiDui App Pattern

```javascript
import { DatabaseServiceInit } from './DatabaseServiceInit';
import { dbConnectionPool } from './DatabaseConnectionPool';  // Your existing pool!

// Option A: Use your existing pool directly
const storage = new ExpoSqliteStorage({
  database: await DatabaseServiceInit.init(),
  connectionPool: dbConnectionPool,  // Reuse your existing pool!
  collectionMapping: (collection) => `userdata.${collection}`,
  enableCrossDbQueries: true
});

// Option B: Create a dedicated ShareDB pool
const sharedbPool = new StandardSQLiteConnectionPool({
  createConnection: () => DatabaseServiceInit.init(),
  maxConnections: 3,  // Smaller pool for ShareDB operations
  minConnections: 1,
  debug: true
});

const storage = new ExpoSqliteStorage({
  database: await DatabaseServiceInit.init(),
  connectionPool: sharedbPool,
  collectionMapping: (collection) => `userdata.${collection}`,
  enableCrossDbQueries: true
});
```

### Cross-Database Analytics with Pool

```javascript
// Heavy analytics queries automatically use connection pool
const analyticsQuery = `
  SELECT 
    COUNT(*) as user_terms,
    AVG(p.learn_rank) as avg_difficulty,
    COUNT(CASE WHEN json_extract(u.data, '$.payload.starred_at') IS NOT NULL THEN 1 END) as starred_count
  FROM userdata.term u 
  JOIN phrase p ON json_extract(u.data, '$.payload.text') = p.text
  WHERE p.learn_rank BETWEEN ? AND ?
  GROUP BY json_extract(u.data, '$.meta.user_id')
`;

storage.executeCrossDbQuery(analyticsQuery, [1, 1000], (error, results) => {
  if (error) return console.error('Analytics failed:', error);
  
  console.log('User learning analytics:', results);
  // This query used a pooled connection automatically!
});
```

### Manual Pool Operations

```javascript
// For operations that need explicit pool control
storage.withPooledConnection(async (conn) => {
  // This connection is isolated from main storage operations
  const stats = await conn.getFirstAsync(`
    SELECT COUNT(*) as count 
    FROM userdata.term 
    WHERE json_extract(data, '$.payload.created_at') > ?
  `, [new Date(Date.now() - 24*60*60*1000).toISOString()]);
  
  const examples = await conn.getAllAsync(`
    SELECT data 
    FROM userdata.term 
    WHERE json_extract(data, '$.payload.starred_at') IS NOT NULL
    LIMIT 10
  `);
  
  return { todayCount: stats.count, starredExamples: examples };
}, (error, result) => {
  if (error) return console.error('Manual pool operation failed:', error);
  console.log('Results:', result.todayCount, result.starredExamples.length);
});
```

## Monitoring and Debugging

### Pool Statistics

```javascript
storage.getStats((error, stats) => {
  console.log('Storage Stats:', {
    hasConnectionPool: stats.hasConnectionPool,
    isDualDatabase: stats.isDualDatabase,
    
    // Connection pool metrics (if pool is available)
    poolSize: stats.connectionPool?.size,
    poolAvailable: stats.connectionPool?.available,
    poolBorrowed: stats.connectionPool?.borrowed,
    poolHealthScore: stats.connectionPool?.healthScore,
    poolIsHealthy: stats.connectionPool?.isHealthy,
    
    // Pool lifecycle stats
    connectionsCreated: stats.connectionPool?.connectionsCreated,
    connectionsDestroyed: stats.connectionPool?.connectionsDestroyed,
    acquireSuccesses: stats.connectionPool?.acquireSuccesses,
    acquireFailures: stats.connectionPool?.acquireFailures,
  });
});
```

### Health Monitoring

```javascript
// Check pool health periodically
setInterval(() => {
  if (storage.connectionPool && storage.connectionPool.getStats) {
    const poolStats = storage.connectionPool.getStats();
    
    if (!poolStats.isHealthy) {
      console.warn('Connection pool unhealthy:', {
        healthScore: poolStats.healthScore,
        pending: poolStats.pending,
        invalid: poolStats.invalid,
        borrowed: poolStats.borrowed
      });
    }
  }
}, 30000); // Check every 30 seconds
```

### Debug Logging

```javascript
const storage = new ExpoSqliteStorage({
  database: db,
  connectionPool: new StandardSQLiteConnectionPool({
    createConnection: () => DatabaseServiceInit.init(),
    debug: true  // Enable pool debugging
  }),
  debug: true    // Enable storage debugging
});

// Output example:
// StandardSQLiteConnectionPool: Creating new connection
// StandardSQLiteConnectionPool: Connection created successfully  
// StandardSQLiteConnectionPool: Connection validation passed
// ExpoSqliteStorage: Using injected connection pool
// StandardSQLiteConnectionPool: Pool closed successfully
```

## Best Practices

### 1. Choose Appropriate Pool Size

```javascript
// For mobile apps (React Native)
const mobilePool = new StandardSQLiteConnectionPool({
  createConnection: () => DatabaseServiceInit.init(),
  maxConnections: 3,  // Lower for mobile - limited resources
  minConnections: 1,
  acquireTimeout: 3000
});

// For desktop/server apps
const desktopPool = new StandardSQLiteConnectionPool({
  createConnection: () => DatabaseServiceInit.init(),
  maxConnections: 8,  // Higher for desktop - more resources
  minConnections: 2,
  acquireTimeout: 5000
});
```

### 2. Use Your Existing Pool

```javascript
// ✅ DO: Reuse your existing connection pool
const storage = new ExpoSqliteStorage({
  database: db,
  connectionPool: yourExistingPool  // Dependency injection!
});

// ❌ DON'T: Create unnecessary pools
const storage = new ExpoSqliteStorage({
  database: db,
  connectionPool: new StandardSQLiteConnectionPool({...})  // Extra complexity
});
```

### 3. Monitor Pool Health

```javascript
// ✅ DO: Check pool health in production
const poolStats = storage.connectionPool?.getStats();
if (poolStats && poolStats.healthScore < 80) {
  // Alert or take corrective action
}

// ✅ DO: Log connection pool metrics
console.log('Pool utilization:', poolStats.borrowed / poolStats.size);
```

### 4. Handle Pool Errors Gracefully

```javascript
storage.executeCrossDbQuery(query, params, (error, results) => {
  if (error) {
    if (error.message.includes('timeout') || error.message.includes('pool')) {
      // Pool-related error - maybe retry or degrade gracefully
      console.warn('Pool error, falling back:', error.message);
      // Fallback to main connection or cached data
    } else {
      // SQL or data error
      console.error('Query error:', error.message);
    }
  }
});
```

## Troubleshooting

### Common Issues

**Issue**: "Connection pool must implement withConnection(operation, callback) method"
**Solution**: Ensure your pool has a `withConnection` method:
```javascript
const pool = {
  withConnection: function(operation, callback) {
    // Your implementation
  }
};
```

**Issue**: Pool connections not being released
**Solution**: Always use `withConnection()` pattern, never manual `getConnection()`/`releaseConnection()`:
```javascript
// ✅ DO
pool.withConnection(async (conn) => {
  return await conn.getAllAsync('SELECT * FROM table');
}, callback);

// ❌ DON'T
const conn = await pool.getConnection();
const result = await conn.getAllAsync('SELECT * FROM table');
// Forgot to release! Connection leak!
```

**Issue**: "Database not available" errors
**Solution**: Ensure main database connection is provided:
```javascript
const storage = new ExpoSqliteStorage({
  database: db,              // ← Must provide main connection
  connectionPool: pool       // Pool is for additional operations
});
```

**Issue**: Poor pool performance
**Solution**: Tune pool parameters:
```javascript
const pool = new StandardSQLiteConnectionPool({
  createConnection: factory,
  maxConnections: 3,        // Reduce if too many connections
  acquireTimeout: 2000,     // Reduce timeout for faster failures
  idleTimeout: 10000,       // Reduce idle time to free resources
  testOnBorrow: false       // Disable if validation is expensive
});
```

## Performance Characteristics

### Operation Types vs Connection Usage

| Operation Type | Uses Pool? | Reason |
|----------------|------------|--------|
| `connection.get('doc', 'id')` | No | Single doc, use main connection |
| `connection.getBulk(['id1', 'id2'])` | Future | Bulk operations benefit from isolation |
| `storage.executeCrossDbQuery()` | Yes | Complex JOINs benefit from isolation |
| `storage.withPooledConnection()` | Yes | Explicitly requested pool usage |
| Document operations (create/edit) | No | Real-time ops use main connection |
| Analytics/reporting queries | Future | Long-running queries benefit from isolation |

### Overhead Analysis

- **Pool Creation**: ~1-5ms per connection
- **Connection Acquisition**: ~0.1-1ms from pool
- **Connection Validation**: ~0.5-2ms (if enabled)
- **Query Execution**: Same as non-pooled (SQLite performance)
- **Memory Overhead**: ~1-5MB per connection

## Migration Guide

### From Single Connection

```javascript
// Before
const storage = new ExpoSqliteStorage({
  database: db,
  schemaPrefix: 'userdata'
});

// After (backward compatible!)
const storage = new ExpoSqliteStorage({
  database: db,                    // Same main connection
  connectionPool: yourPool,        // Add pool for heavy operations
  schemaPrefix: 'userdata'         // All other options unchanged
});
```

### From Custom Pool to Standard Pool

```javascript
// Before: Your custom pool
const customPool = new YourPool(options);

// After: Standard pool with same interface
const standardPool = new StandardSQLiteConnectionPool({
  createConnection: customPool.createConnection,
  maxConnections: customPool.maxSize,
  minConnections: customPool.minSize,
  debug: true
});

// Storage usage unchanged!
const storage = new ExpoSqliteStorage({
  database: db,
  connectionPool: standardPool  // Drop-in replacement!
});
```

## Conclusion

Connection pooling in ShareDB provides:

- ✅ **Zero Breaking Changes** - All existing code continues to work
- ✅ **Dependency Injection** - Use any pool that implements `withConnection()`
- ✅ **Automatic Optimization** - Pool used intelligently for beneficial operations
- ✅ **Production Ready** - Built on battle-tested `generic-pool` library
- ✅ **Full Compatibility** - Works with your existing DatabaseConnectionPool
- ✅ **Comprehensive Monitoring** - Health metrics and debug logging

The connection pooling integration allows you to optimize database performance while maintaining the simplicity and reliability of ShareDB's storage layer.