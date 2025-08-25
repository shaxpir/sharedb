var BaseSchemaStrategy = require('./base-schema-strategy');
var logger = require('../../../logger');

/**
 * Default schema strategy that implements the original ShareDB storage pattern:
 * - Single 'docs' table for all document collections
 * - Single 'meta' table for inventory and metadata
 * - All-or-nothing encryption (entire payload encrypted)
 * - Supports dual-database architectures with schema prefixes and collection mapping
 */
module.exports = DefaultSchemaStrategy;
function DefaultSchemaStrategy(options) {
  BaseSchemaStrategy.call(this, options);
  this.useEncryption = options.useEncryption || false;
  this.encryptionCallback = options.encryptionCallback;
  this.decryptionCallback = options.decryptionCallback;
  
  // Dual-database support
  this.schemaPrefix = options.schemaPrefix || '';
  this.collectionMapping = options.collectionMapping;
}

// Inherit from BaseSchemaStrategy
DefaultSchemaStrategy.prototype = Object.create(BaseSchemaStrategy.prototype);
DefaultSchemaStrategy.prototype.constructor = DefaultSchemaStrategy;

/**
 * Initialize the default schema with 'docs' and 'meta' tables
 */
DefaultSchemaStrategy.prototype.initializeSchema = function(db, callback) {
  var strategy = this;
  var promises = [];
  
  // Get table names with proper prefixes/mapping
  var docsTable = this.getTableName('docs');
  var metaTable = this.getTableName('__meta__');
  
  // Create docs table
  promises.push(db.runAsync(
    'CREATE TABLE IF NOT EXISTS ' + docsTable + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
    ')'
  ).promise());
  
  // Create meta table
  promises.push(db.runAsync(
    'CREATE TABLE IF NOT EXISTS ' + metaTable + ' (' +
      'id TEXT PRIMARY KEY, ' +
      'data JSON' +
    ')'
  ).promise());
  
  Promise.all(promises).then(function() {
    strategy.debug && logger.info('DefaultSchemaStrategy: Schema initialized with tables: ' + docsTable + ', ' + metaTable);
    callback && callback();
  }).catch(function(error) {
    callback && callback(error);
  });
};

/**
 * Validate that the schema exists
 */
DefaultSchemaStrategy.prototype.validateSchema = function(db, callback) {
  var strategy = this;
  var promises = [];
  
  // Check if tables exist
  promises.push(db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='docs'"
  ).promise());
  
  promises.push(db.getFirstAsync(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
  ).promise());
  
  Promise.all(promises).then(function(results) {
    var isValid = results[0] && results[1];
    callback && callback(null, isValid);
  }).catch(function(error) {
    callback && callback(error, false);
  });
};

/**
 * Get table name - supports dual-database architectures with collection mapping
 */
DefaultSchemaStrategy.prototype.getTableName = function(collection) {
  var baseName;
  
  // Determine base table name
  if (collection === '__meta__') {
    baseName = 'meta';
  } else {
    baseName = 'docs';
  }
  
  // Apply collection mapping callback if provided
  if (typeof this.collectionMapping === 'function') {
    return this.collectionMapping(baseName);
  }
  
  // Apply schema prefix if provided
  if (this.schemaPrefix) {
    return this.schemaPrefix + '.' + baseName;
  }
  
  // Default behavior
  return baseName;
};

/**
 * Validate and sanitize table name to prevent SQL injection
 */
DefaultSchemaStrategy.prototype.validateTableName = function(tableName) {
  if (tableName !== 'docs' && tableName !== 'meta') {
    throw new Error('Invalid table name: ' + tableName + '. Must be "docs" or "meta"');
  }
  return tableName;
};

/**
 * Write records using the default schema
 */
DefaultSchemaStrategy.prototype.writeRecords = function(adapter, recordsByType, callback) {
  var strategy = this;
  var totalCount = 0;
  var recordsToWrite = [];
  
  var docsTable = this.getTableName('docs');
  var metaTable = this.getTableName('__meta__');
  
  // Process docs records
  if (recordsByType.docs) {
    var docsRecords = Array.isArray(recordsByType.docs) ? recordsByType.docs : [recordsByType.docs];
    for (var i = 0; i < docsRecords.length; i++) {
      var record = docsRecords[i];
      record = strategy.maybeEncryptRecord(record);
      recordsToWrite.push({
        sql: 'INSERT OR REPLACE INTO ' + docsTable + ' (id, data) VALUES (?, ?)',
        params: [record.id, JSON.stringify(record)]
      });
      totalCount++;
    }
  }
  
  // Process meta records
  if (recordsByType.meta) {
    var metaRecords = Array.isArray(recordsByType.meta) ? recordsByType.meta : [recordsByType.meta];
    for (var j = 0; j < metaRecords.length; j++) {
      var metaRecord = metaRecords[j];
      // Meta records are not encrypted in the default strategy
      recordsToWrite.push({
        sql: 'INSERT OR REPLACE INTO ' + metaTable + ' (id, data) VALUES (?, ?)',
        params: [metaRecord.id, JSON.stringify(metaRecord.payload)]
      });
      totalCount++;
    }
  }
  
  // Write all records using transaction
  if (recordsToWrite.length === 0) {
    return callback && callback();
  }
  
  adapter.transaction(function(txAdapter, txCallback) {
    var recordIndex = 0;
    function writeNextRecord() {
      if (recordIndex >= recordsToWrite.length) {
        return txCallback();
      }
      
      var record = recordsToWrite[recordIndex++];
      txAdapter.run(record.sql, record.params, function(error) {
        if (error) return txCallback(error);
        writeNextRecord();
      });
    }
    writeNextRecord();
  }, function(error) {
    if (error) return callback && callback(error);
    strategy.debug && logger.info('DefaultSchemaStrategy: Wrote ' + totalCount + ' records');
    callback && callback();
  });
};

/**
 * Read a single record
 */
DefaultSchemaStrategy.prototype.readRecord = function(adapter, type, collection, id, callback) {
  var strategy = this;
  var tableName = type === 'meta' ? this.getTableName('__meta__') : this.getTableName('docs');
  
  adapter.get(
    'SELECT data FROM ' + tableName + ' WHERE id = ?',
    [id],
    function(error, row) {
      if (error) return callback && callback(error, null);
      if (!row) return callback && callback(null, null);
      
      try {
        var record = JSON.parse(row.data);
        
        // Decrypt if needed (only for docs, not meta)
        if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
          record = strategy.maybeDecryptRecord(record);
        }
        
        callback && callback(null, record);
      } catch (parseError) {
        callback && callback(parseError, null);
      }
    }
  );
};

/**
 * Read all records of a type
 */
DefaultSchemaStrategy.prototype.readAllRecords = function(adapter, type, collection, callback) {
  var strategy = this;
  var tableName = type === 'meta' ? this.getTableName('__meta__') : this.getTableName('docs');
  
  adapter.all(
    'SELECT id, data FROM ' + tableName,
    [],
    function(error, rows) {
      if (error) return callback && callback(error, null);
      
      try {
        var records = [];
        for (var i = 0; i < rows.length; i++) {
          var record = JSON.parse(rows[i].data);
          
          // Decrypt if needed (only for docs, not meta)
          if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
            record = strategy.maybeDecryptRecord(record);
          }
          
          records.push({
            id: rows[i].id,
            payload: record.payload || record
          });
        }
        
        callback && callback(null, records);
      } catch (parseError) {
        callback && callback(parseError, null);
      }
    }
  );
};

/**
 * Read multiple records by ID in a single SQL query (bulk operation)
 */
DefaultSchemaStrategy.prototype.readRecordsBulk = function(adapter, type, collection, ids, callback) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return callback && callback(null, []);
  }
  
  var strategy = this;
  var tableName = type === 'meta' ? this.getTableName('__meta__') : this.getTableName('docs');
  
  // Create placeholders for the IN clause (?, ?, ?, ...)
  var placeholders = ids.map(function() { return '?'; }).join(', ');
  var sql = 'SELECT id, data FROM ' + tableName + ' WHERE id IN (' + placeholders + ')';
  
  adapter.all(sql, ids, function(error, rows) {
    if (error) {
      strategy.debug && logger.error('DefaultSchemaStrategy: Error in bulk read from ' + tableName + ': ' + error);
      return callback && callback(error, null);
    }
    
    try {
      var records = [];
      
      for (var i = 0; i < rows.length; i++) {
        var record = JSON.parse(rows[i].data);
        
        // Decrypt if needed (only for docs, not meta)
        if (type === 'docs' && strategy.useEncryption && record.encrypted_payload) {
          record = strategy.maybeDecryptRecord(record);
        }
        
        records.push({
          id: rows[i].id,
          payload: record.payload || record
        });
      }
      
      strategy.debug && logger.info('DefaultSchemaStrategy: Bulk read ' + records.length + '/' + ids.length + ' records from ' + tableName);
      callback && callback(null, records);
    } catch (parseError) {
      callback && callback(parseError, null);
    }
  });
};

/**
 * Delete a record
 */
DefaultSchemaStrategy.prototype.deleteRecord = function(adapter, type, collection, id, callback) {
  var strategy = this;
  var tableName = type === 'meta' ? this.getTableName('__meta__') : this.getTableName('docs');
  
  adapter.run(
    'DELETE FROM ' + tableName + ' WHERE id = ?',
    [id],
    function(error) {
      if (error) return callback && callback(error);
      
      strategy.debug && logger.info('DefaultSchemaStrategy: Deleted record ' + id + ' from ' + tableName);
      callback && callback();
    }
  );
};

/**
 * Helper to encrypt a record if encryption is enabled
 */
DefaultSchemaStrategy.prototype.maybeEncryptRecord = function(record) {
  if (!this.useEncryption || !this.encryptionCallback) {
    return record;
  }
  
  return {
    id: record.id,
    encrypted_payload: this.encryptionCallback(JSON.stringify(record.payload))
  };
};

/**
 * Helper to decrypt a record if it's encrypted
 */
DefaultSchemaStrategy.prototype.maybeDecryptRecord = function(record) {
  if (!this.useEncryption || !this.decryptionCallback || !record.encrypted_payload) {
    return record;
  }
  
  return {
    id: record.id,
    payload: JSON.parse(this.decryptionCallback(record.encrypted_payload))
  };
};

/**
 * Get inventory type - JSON for default strategy
 */
DefaultSchemaStrategy.prototype.getInventoryType = function() {
  return 'json';
};

/**
 * Initialize inventory as a single JSON document in meta table
 */
DefaultSchemaStrategy.prototype.initializeInventory = function(adapter, callback) {
  var strategy = this;
  var inventory = {
    id: 'inventory',
    payload: {
      collections: {}
    }
  };
  
  var metaTable = this.getTableName('__meta__');
  
  // Check if inventory already exists
  adapter.get(
    'SELECT data FROM ' + metaTable + ' WHERE id = ?',
    ['inventory'],
    function(error, row) {
      if (error) return callback && callback(error, null);
      
      if (row) {
        // Inventory exists, return it
        try {
          var existing = JSON.parse(row.data);
          callback && callback(null, {
            id: 'inventory',
            payload: existing
          });
        } catch (parseError) {
          callback && callback(parseError, null);
        }
      } else {
        // Create new inventory
        adapter.run(
          'INSERT INTO ' + metaTable + ' (id, data) VALUES (?, ?)',
          ['inventory', JSON.stringify(inventory.payload)],
          function(error) {
            if (error) return callback && callback(error, null);
            callback && callback(null, inventory);
          }
        );
      }
    }
  );
};

/**
 * Read the entire inventory from the JSON document
 */
DefaultSchemaStrategy.prototype.readInventory = function(adapter, callback) {
  var metaTable = this.getTableName('__meta__');
  
  adapter.get(
    'SELECT data FROM ' + metaTable + ' WHERE id = ?',
    ['inventory'],
    function(error, row) {
      if (error) return callback && callback(error, null);
      
      if (!row) {
        return callback && callback(null, {
          id: 'inventory',
          payload: { collections: {} }
        });
      }
      
      try {
        var inventory = JSON.parse(row.data);
        callback && callback(null, {
          id: 'inventory',
          payload: inventory
        });
      } catch (parseError) {
        callback && callback(parseError, null);
      }
    }
  );
};

/**
 * Update inventory by modifying the JSON document
 */
DefaultSchemaStrategy.prototype.updateInventoryItem = function(adapter, collection, docId, version, operation, callback) {
  var strategy = this;
  
  // Read current inventory
  this.readInventory(adapter, function(error, inventory) {
    if (error) {
      callback && callback(error);
      return;
    }
    
    var payload = inventory.payload || { collections: {} };
    
    // Ensure collection exists
    if (!payload.collections[collection]) {
      payload.collections[collection] = {};
    }
    
    // Update based on operation
    if (operation === 'add' || operation === 'update') {
      payload.collections[collection][docId] = version;
    } else if (operation === 'remove') {
      delete payload.collections[collection][docId];
      
      // Clean up empty collections
      if (Object.keys(payload.collections[collection]).length === 0) {
        delete payload.collections[collection];
      }
    }
    
    // Write updated inventory back
    var metaTable = strategy.getTableName('__meta__');
    adapter.run(
      'UPDATE ' + metaTable + ' SET data = ? WHERE id = ?',
      [JSON.stringify(payload), 'inventory'],
      function(err) {
        if (err) return callback && callback(err);
        
        strategy.debug && logger.info('DefaultSchemaStrategy: Updated inventory for ' + collection + '/' + docId);
        callback && callback();
      }
    );
  });
};