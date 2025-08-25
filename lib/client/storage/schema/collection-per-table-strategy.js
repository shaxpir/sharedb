var BaseSchemaStrategy = require('./base-schema-strategy');
var logger = require('../../../logger');

/**
 * Schema strategy that creates a separate table for each collection.
 * This allows for:
 * - Collection-specific indexes
 * - Field-level encryption configuration per collection
 * - Optimized queries per collection
 * - Better performance for large collections
 */
module.exports = CollectionPerTableStrategy;
function CollectionPerTableStrategy(options) {
  BaseSchemaStrategy.call(this, options);
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  
  // Collection-specific configuration
  // Example: {
  //   'users': {
  //     indexes: ['email', 'username'],
  //     encryptedFields: ['password', 'ssn']
  //   },
  //   'posts': {
  //     indexes: ['authorId', 'createdAt'],
  //     encryptedFields: []
  //   }
  // }
  this.collectionConfig = options.collectionConfig || {};
  
  // Track which tables have been created
  this.createdTables = {};
}

// Inherit from BaseSchemaStrategy
CollectionPerTableStrategy.prototype = Object.create(BaseSchemaStrategy.prototype);
CollectionPerTableStrategy.prototype.constructor = CollectionPerTableStrategy;

/**
 * Initialize the schema - creates meta table, inventory table, and any pre-configured collection tables
 */
CollectionPerTableStrategy.prototype.initializeSchema = function(db, callback) {
  var strategy = this;
  var promises = [];
  
  // Always create meta table
  promises.push(db.runAsync(
    'CREATE TABLE IF NOT EXISTS meta (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
    ')'
  ).promise());
  
  // Create inventory table for better scalability
  promises.push(db.runAsync(
    'CREATE TABLE IF NOT EXISTS inventory (' +
      'collection TEXT NOT NULL, ' +
      'doc_id TEXT NOT NULL, ' +
      'version INTEGER, ' +
      'updated_at INTEGER, ' +
      'PRIMARY KEY (collection, doc_id)' +
    ')'
  ).promise());
  
  // Create indexes on inventory table for fast lookups
  promises.push(db.runAsync(
    'CREATE INDEX IF NOT EXISTS idx_inventory_collection ON inventory (collection)'
  ).promise());
  
  promises.push(db.runAsync(
    'CREATE INDEX IF NOT EXISTS idx_inventory_updated ON inventory (updated_at)'
  ).promise());
  
  // Create tables for any pre-configured collections
  var collections = Object.keys(this.collectionConfig);
  for (var i = 0; i < collections.length; i++) {
    var collection = collections[i];
    promises.push(this.createCollectionTable(db, collection));
  }
  
  Promise.all(promises).then(function() {
    strategy.debug && logger.info('CollectionPerTableStrategy: Schema initialized');
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Create a table for a specific collection with its indexes
 */
CollectionPerTableStrategy.prototype.createCollectionTable = function(db, collection) {
  var strategy = this;
  var tableName = this.getTableName(collection);
  var config = this.collectionConfig[collection] || {};
  var promises = [];
  
  // Create the table
  promises.push(db.runAsync(
    'CREATE TABLE IF NOT EXISTS ' + tableName + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'collection TEXT, ' +
      'data JSON' +
    ')'
  ).promise());
  
  // Create indexes if configured
  if (config.indexes && config.indexes.length > 0) {
    for (var i = 0; i < config.indexes.length; i++) {
      var field = config.indexes[i];
      var indexName = tableName + '_' + field + '_idx';
      promises.push(db.runAsync(
        'CREATE INDEX IF NOT EXISTS ' + indexName + ' ON ' + tableName + 
        ' (json_extract(data, "$.' + field + '"))'
      ).promise());
    }
  }
  
  return Promise.all(promises).then(function() {
    strategy.createdTables[collection] = true;
    strategy.debug && logger.info('CollectionPerTableStrategy: Created table for collection: ' + collection);
  });
};

/**
 * Validate that required tables exist
 */
CollectionPerTableStrategy.prototype.validateSchema = function(db, callback) {
  var strategy = this;
  
  // Check meta table exists
  db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
  ).then(function(result) {
    callback && callback(null, !!result);
  }).catch(function(error) {
    callback && callback(error, false);
  });
};

/**
 * Get table name for a collection
 */
CollectionPerTableStrategy.prototype.getTableName = function(collection) {
  if (collection === '__meta__') {
    return 'meta';
  }
  // Sanitize collection name for use as table name
  return 'col_' + collection.replace(/[^a-zA-Z0-9_]/g, '_');
};

/**
 * Ensure a collection table exists before writing to it
 */
CollectionPerTableStrategy.prototype.ensureCollectionTable = function(db, collection, callback) {
  var strategy = this;
  
  if (this.createdTables[collection]) {
    callback && callback();
    return;
  }
  
  this.createCollectionTable(db, collection).then(function() {
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Write records to collection-specific tables
 */
CollectionPerTableStrategy.prototype.writeRecords = function(db, recordsByType, callback) {
  var strategy = this;
  var promises = [];
  var totalCount = 0;
  
  // Process docs records
  if (recordsByType.docs) {
    var docsRecords = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs];
    
    // Group records by collection
    var recordsByCollection = {};
    for (var i = 0; i < docsRecords.length; i++) {
      var record = docsRecords[i];
      var collection = record.collection || 'default';
      if (!recordsByCollection[collection]) {
        recordsByCollection[collection] = [];
      }
      recordsByCollection[collection].push(record);
    }
    
    // Write to each collection's table
    var collections = Object.keys(recordsByCollection);
    for (var j = 0; j < collections.length; j++) {
      var col = collections[j];
      var records = recordsByCollection[col];
      
      // Ensure table exists
      promises.push(
        new Promise(function(resolve, reject) {
          strategy.ensureCollectionTable(db, col, function(error) {
            if (error) {
              reject(error);
              return;
            }
            
            var tableName = strategy.getTableName(col);
            var writePromises = [];
            
            for (var k = 0; k < records.length; k++) {
              var rec = records[k];
              rec = strategy.encryptRecordForCollection(rec, col);
              writePromises.push(db.runAsync(
                'INSERT OR REPLACE INTO ' + tableName + ' (id, collection, data) VALUES (?, ?, ?)',
                [rec.id, col, JSON.stringify(rec)]
              ).promise());
              totalCount++;
            }
            
            Promise.all(writePromises).then(resolve).catch(reject);
          });
        })
      );
    }
  }
  
  // Process meta records (always go to meta table)
  if (recordsByType.meta) {
    var metaRecords = Array.isArray(recordsByType.meta) ? recordsByType.meta : [recordsByType.meta];
    for (var m = 0; m < metaRecords.length; m++) {
      var metaRecord = metaRecords[m];
      promises.push(db.runAsync(
        'INSERT OR REPLACE INTO meta (id, data) VALUES (?, ?)',
        [metaRecord.id, JSON.stringify(metaRecord.payload)]
      ).promise());
      totalCount++;
    }
  }
  
  Promise.all(promises).then(function() {
    strategy.debug && logger.info('CollectionPerTableStrategy: Wrote ' + totalCount + ' records');
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Read a single record from a collection-specific table
 */
CollectionPerTableStrategy.prototype.readRecord = function(db, type, collection, id, callback) {
  var strategy = this;
  
  if (type === 'meta') {
    db.getFirstAsync(
      'SELECT data FROM meta WHERE id = ?',
      [id]
    ).then(function(row) {
      if (!row) {
        callback && callback(null, null);
        return;
      }
      var record = JSON.parse(row.data);
      callback && callback(null, record);
    }).catch(function(error) {
      callback && callback(error, null);
    });
  } else {
    // For docs, read from collection-specific table
    var tableName = this.getTableName(collection);
    
    // Check if table exists
    db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]
    ).then(function(tableExists) {
      if (!tableExists) {
        callback && callback(null, null);
        return;
      }
      
      return db.getFirstAsync(
        'SELECT data FROM ' + tableName + ' WHERE id = ?',
        [id]
      );
    }).then(function(row) {
      if (!row) {
        callback && callback(null, null);
        return;
      }
      
      var record = JSON.parse(row.data);
      record = strategy.decryptRecordForCollection(record, collection);
      callback && callback(null, record);
    }).catch(function(error) {
      callback && callback(error, null);
    });
  }
};

/**
 * Delete a record from a collection-specific table
 */
CollectionPerTableStrategy.prototype.deleteRecord = function(db, type, collection, id, callback) {
  var strategy = this;
  
  if (type === 'meta') {
    db.runAsync('DELETE FROM meta WHERE id = ?', [id]).then(function() {
      strategy.debug && logger.info('CollectionPerTableStrategy: Deleted meta record ' + id);
      callback && callback();
    }).catch(function(error) {
      callback && callback(error);
    });
  } else {
    var tableName = this.getTableName(collection);
    
    // Check if table exists before trying to delete
    db.getFirstAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]
    ).then(function(tableExists) {
      if (!tableExists) {
        callback && callback();
        return;
      }
      
      return db.runAsync('DELETE FROM ' + tableName + ' WHERE id = ?', [id]);
    }).then(function() {
      strategy.debug && logger.info('CollectionPerTableStrategy: Deleted record ' + id + ' from ' + tableName);
      callback && callback();
    }).catch(function(error) {
      callback && callback(error);
    });
  }
};

/**
 * Encrypt specific fields for a collection based on configuration
 */
CollectionPerTableStrategy.prototype.encryptRecordForCollection = function(record, collection) {
  if (!this.useEncryption || !this.encryptionCallback) {
    return record;
  }
  
  var config = this.collectionConfig[collection] || {};
  var encryptedFields = config.encryptedFields || [];
  
  if (encryptedFields.length === 0) {
    // No field-level encryption, encrypt entire payload
    return {
      id: record.id,
      collection: collection,
      encrypted_payload: this.encryptionCallback(JSON.stringify(record.payload))
    };
  }
  
  // Field-level encryption
  var payload = Object.assign({}, record.payload);
  var encryptedData = {};
  
  for (var i = 0; i < encryptedFields.length; i++) {
    var field = encryptedFields[i];
    if (payload[field] !== undefined) {
      encryptedData[field] = this.encryptionCallback(JSON.stringify(payload[field]));
      delete payload[field];
    }
  }
  
  return {
    id: record.id,
    collection: collection,
    payload: payload,
    encrypted_fields: encryptedData
  };
};

/**
 * Decrypt specific fields for a collection based on configuration
 */
CollectionPerTableStrategy.prototype.decryptRecordForCollection = function(record, collection) {
  if (!this.useEncryption || !this.decryptionCallback) {
    return record;
  }
  
  // Handle full payload encryption
  if (record.encrypted_payload) {
    return {
      id: record.id,
      collection: collection,
      payload: JSON.parse(this.decryptionCallback(record.encrypted_payload))
    };
  }
  
  // Handle field-level encryption
  if (record.encrypted_fields) {
    var payload = Object.assign({}, record.payload);
    var encryptedFields = Object.keys(record.encrypted_fields);
    
    for (var i = 0; i < encryptedFields.length; i++) {
      var field = encryptedFields[i];
      payload[field] = JSON.parse(this.decryptionCallback(record.encrypted_fields[field]));
    }
    
    return {
      id: record.id,
      collection: collection,
      payload: payload
    };
  }
  
  return record;
};

/**
 * Get inventory type - table-based for better performance
 */
CollectionPerTableStrategy.prototype.getInventoryType = function() {
  return 'table';
};

/**
 * Initialize inventory table (already created in initializeSchema)
 */
CollectionPerTableStrategy.prototype.initializeInventory = function(db, callback) {
  // Inventory table is created in initializeSchema
  // Return an empty inventory structure for compatibility
  callback && callback(null, {
    id: 'inventory',
    payload: { collections: {} }
  });
};

/**
 * Read the entire inventory from the table
 */
CollectionPerTableStrategy.prototype.readInventory = function(db, callback) {
  db.getAllAsync(
    'SELECT collection, doc_id, version FROM inventory ORDER BY collection, doc_id'
  ).then(function(rows) {
    var inventory = { collections: {} };
    
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!inventory.collections[row.collection]) {
        inventory.collections[row.collection] = {};
      }
      inventory.collections[row.collection][row.doc_id] = row.version;
    }
    
    callback && callback(null, {
      id: 'inventory',
      payload: inventory
    });
  }).catch(function(error) {
    callback && callback(error, null);
  });
};

/**
 * Update inventory using efficient table operations
 */
CollectionPerTableStrategy.prototype.updateInventoryItem = function(db, collection, docId, version, operation, callback) {
  var strategy = this;
  var now = Date.now();
  
  if (operation === 'add' || operation === 'update') {
    // Insert or update inventory item
    db.runAsync(
      'INSERT OR REPLACE INTO inventory (collection, doc_id, version, updated_at) VALUES (?, ?, ?, ?)',
      [collection, docId, version, now]
    ).then(function() {
      strategy.debug && logger.info('CollectionPerTableStrategy: Updated inventory for ' + collection + '/' + docId);
      callback && callback();
    }).catch(function(error) {
      callback && callback(error);
    });
  } else if (operation === 'remove') {
    // Delete inventory item
    db.runAsync(
      'DELETE FROM inventory WHERE collection = ? AND doc_id = ?',
      [collection, docId]
    ).then(function() {
      strategy.debug && logger.info('CollectionPerTableStrategy: Removed inventory for ' + collection + '/' + docId);
      callback && callback();
    }).catch(function(error) {
      callback && callback(error);
    });
  } else {
    callback && callback(new Error('Invalid inventory operation: ' + operation));
  }
};

/**
 * Get inventory stats for a collection (bonus method for table-based approach)
 */
CollectionPerTableStrategy.prototype.getCollectionStats = function(db, collection, callback) {
  db.getFirstAsync(
    'SELECT COUNT(*) as count, MAX(version) as maxVersion FROM inventory WHERE collection = ?',
    [collection]
  ).then(function(row) {
    callback && callback(null, {
      documentCount: row.count || 0,
      maxVersion: row.maxVersion || 0
    });
  }).catch(function(error) {
    callback && callback(error, null);
  });
};