/**
 * ShareDB Batch Writing Example
 * 
 * This example demonstrates the enhanced batch writing capabilities that allow
 * caller-controlled batching of document writes to storage.
 * 
 * Key Performance Benefits:
 * - Control over when batches are flushed to storage
 * - Accumulate large numbers of documents before writing
 * - Reduce storage I/O overhead for bulk operations
 * - Fine-grained control over storage timing
 */

var ShareDB = require('../lib/sharedb');
var Connection = require('../lib/client/connection');
var DurableStore = require('../lib/client/durable-store');
var SqliteStorage = require('../lib/client/storage/sqlite-storage');
var CollectionPerTableStrategy = require('../lib/client/storage/schema/collection-per-table-strategy');
var ExpoSqliteAdapter = require('../lib/client/storage/adapters/expo-sqlite-adapter');

// ===============================
// Setup for Batch Writing Demo
// ===============================

async function setupBatchWritingDemo() {
  // Collection config optimized for bulk writes
  var collectionConfig = {
    documents: {
      indexes: ['authorId', 'categoryId', 'status', 'createdAt'],
      encryptedFields: ['content', 'privateNotes']
    },
    users: {
      indexes: ['email', 'department', 'role'],
      encryptedFields: ['personalData']
    }
  };

  var adapter = new ExpoSqliteAdapter({
    database: null, // Your database instance
    debug: true
  });

  var schemaStrategy = new CollectionPerTableStrategy({
    collectionConfig: collectionConfig,
    useEncryption: false, // Simplified for demo
    debug: true
  });

  var storage = new SqliteStorage({
    adapter: adapter,
    schemaStrategy: schemaStrategy,
    debug: true
  });

  var durableStore = new DurableStore(storage, {
    maxBatchSize: 50, // Large batches for bulk operations
    debug: true
  });

  var connection = new Connection(null, {
    durableStore: {
      storage: storage,
      debug: true
    }
  });

  return { durableStore, connection };
}

// ===============================
// Batch Session Examples
// ===============================

function demonstrateBatchSessions(durableStore, connection) {
  console.log('\n=== Batch Session Control Demo ===\n');

  // Example 1: Controlled batch session with manual flushing
  console.log('1. Controlled Batch Session:');
  
  var session = durableStore.startBatchSession();
  var docs = [];
  
  // Create multiple documents
  for (var i = 0; i < 25; i++) {
    var doc = connection.get('documents', 'doc_' + i);
    doc.create({
      title: 'Document ' + i,
      content: 'This is document number ' + i,
      authorId: 'user_' + Math.floor(i / 5),
      createdAt: new Date().toISOString()
    });
    docs.push(doc);
  }
  
  // Add documents to batch session (no auto-flush)
  session.putDocs(docs, function(error) {
    if (error) {
      console.error('Error adding docs to batch:', error);
      return;
    }
    
    console.log('   ✓ Added ' + docs.length + ' documents to batch session');
    console.log('   Queue size: ' + session.getQueueSize());
    console.log('   Pending writes: ' + session.hasPendingWrites());
    
    // Manually flush when ready
    console.log('   Flushing batch to storage...');
    var startTime = Date.now();
    
    session.flush(function(flushError) {
      if (flushError) {
        console.error('Error flushing batch:', flushError);
        return;
      }
      
      var flushTime = Date.now() - startTime;
      console.log('   ✓ Batch flushed in ' + flushTime + 'ms');
      console.log('   Queue size after flush: ' + session.getQueueSize());
      
      // End the session
      session.end(function() {
        console.log('   ✓ Batch session ended');
      });
    });
  });

  // Example 2: Multiple controlled flushes
  setTimeout(function() {
    console.log('\n2. Multiple Controlled Flushes:');
    
    var multiSession = durableStore.startBatchSession();
    
    // First batch
    var firstBatch = [];
    for (var j = 100; j < 110; j++) {
      var doc = connection.get('documents', 'multi_doc_' + j);
      doc.create({ title: 'Multi Doc ' + j, batch: 1 });
      firstBatch.push(doc);
    }
    
    multiSession.putDocs(firstBatch, function() {
      console.log('   ✓ First batch added (' + firstBatch.length + ' docs)');
      
      // Flush first batch
      multiSession.flush(function() {
        console.log('   ✓ First batch flushed');
        
        // Second batch
        var secondBatch = [];
        for (var k = 110; k < 120; k++) {
          var doc2 = connection.get('documents', 'multi_doc_' + k);
          doc2.create({ title: 'Multi Doc ' + k, batch: 2 });
          secondBatch.push(doc2);
        }
        
        multiSession.putDocs(secondBatch, function() {
          console.log('   ✓ Second batch added (' + secondBatch.length + ' docs)');
          
          // Flush second batch and end
          multiSession.flush(function() {
            console.log('   ✓ Second batch flushed');
            multiSession.end(function() {
              console.log('   ✓ Multi-flush session ended');
            });
          });
        });
      });
    });
  }, 1000);
}

// ===============================
// Bulk Write Convenience Methods
// ===============================

function demonstrateBulkWriteMethods(durableStore, connection) {
  console.log('\n=== Bulk Write Convenience Methods ===\n');

  // Example 1: Simple bulk write with immediate flush
  console.log('1. Simple Bulk Write:');
  
  var bulkDocs = [];
  for (var i = 200; i < 220; i++) {
    var doc = connection.get('documents', 'bulk_doc_' + i);
    doc.create({
      title: 'Bulk Document ' + i,
      category: 'bulk-demo',
      createdAt: new Date().toISOString()
    });
    bulkDocs.push(doc);
  }
  
  var startTime = Date.now();
  durableStore.putDocsBulk(bulkDocs, function(error) {
    if (error) {
      console.error('Bulk write error:', error);
      return;
    }
    
    var bulkTime = Date.now() - startTime;
    console.log('   ✓ Bulk wrote ' + bulkDocs.length + ' documents in ' + bulkTime + 'ms');
  });

  // Example 2: Manual flush control
  setTimeout(function() {
    console.log('\n2. Manual Flush Control:');
    
    // Disable auto-batching
    console.log('   Disabling auto-batch...');
    durableStore.setAutoBatchEnabled(false);
    
    // Add documents without automatic flushing
    var manualDocs = [];
    for (var j = 300; j < 315; j++) {
      var doc = connection.get('documents', 'manual_doc_' + j);
      doc.create({ title: 'Manual Doc ' + j, manual: true });
      manualDocs.push(doc);
      durableStore.putDoc(doc); // Won't auto-flush
    }
    
    console.log('   ✓ Added ' + manualDocs.length + ' docs without flushing');
    console.log('   Queue size: ' + durableStore.getWriteQueueSize());
    
    // Manually flush when ready
    setTimeout(function() {
      console.log('   Manually flushing...');
      durableStore.flush(function() {
        console.log('   ✓ Manual flush completed');
        console.log('   Queue size after flush: ' + durableStore.getWriteQueueSize());
        
        // Re-enable auto-batching
        durableStore.setAutoBatchEnabled(true);
        console.log('   ✓ Auto-batch re-enabled');
      });
    }, 500);
  }, 2000);
}

// ===============================
// Performance Comparison
// ===============================

function compareBatchingStrategies(durableStore, connection) {
  console.log('\n=== Batching Strategy Performance Comparison ===\n');

  var testDocCount = 50;
  var testDocs = [];
  
  // Prepare test documents
  for (var i = 0; i < testDocCount; i++) {
    var doc = connection.get('documents', 'perf_test_' + i);
    doc.create({
      title: 'Performance Test Doc ' + i,
      data: 'Sample data for performance testing',
      index: i,
      timestamp: Date.now()
    });
    testDocs.push(doc);
  }

  // Test 1: Individual writes (current default behavior)
  console.log('1. Individual Writes (Auto-batch):');
  var startTime1 = Date.now();
  var remaining1 = testDocs.length;
  
  testDocs.forEach(function(doc) {
    durableStore.putDoc(doc, function() {
      remaining1--;
      if (remaining1 === 0) {
        var individualTime = Date.now() - startTime1;
        console.log('   ✓ Individual writes: ' + individualTime + 'ms for ' + testDocCount + ' documents');
        
        // Test 2: Single large batch
        setTimeout(function() {
          console.log('\n2. Single Large Batch:');
          
          // Create fresh documents for fair comparison
          var batchTestDocs = [];
          for (var j = 0; j < testDocCount; j++) {
            var doc = connection.get('documents', 'batch_test_' + j);
            doc.create({
              title: 'Batch Test Doc ' + j,
              data: 'Sample data for batch testing',
              index: j,
              timestamp: Date.now()
            });
            batchTestDocs.push(doc);
          }
          
          var startTime2 = Date.now();
          durableStore.putDocsBulk(batchTestDocs, function(error) {
            if (!error) {
              var batchTime = Date.now() - startTime2;
              console.log('   ✓ Bulk batch: ' + batchTime + 'ms for ' + testDocCount + ' documents');
              
              var improvement = Math.round(((individualTime - batchTime) / individualTime) * 100);
              console.log('\n   🚀 Bulk batching is ' + Math.abs(improvement) + '% ' + 
                         (improvement > 0 ? 'faster' : 'slower') + '!');
              
              console.log('\n   Benefits of controlled batching:');
              console.log('   • Reduced storage I/O operations');
              console.log('   • Better control over write timing');
              console.log('   • Optimized for bulk data operations');
              console.log('   • Configurable batch sizes and flush timing');
            }
          });
        }, 1000);
      }
    });
  });
}

// ===============================
// Real-world Use Cases
// ===============================

function demonstrateRealWorldUseCases(durableStore, connection) {
  console.log('\n=== Real-world Batch Writing Use Cases ===\n');

  // Use Case 1: Data Import/Migration
  console.log('1. Data Import Use Case:');
  
  var importSession = durableStore.startBatchSession();
  var importData = [
    { id: 'import1', title: 'Imported Document 1', source: 'external-api' },
    { id: 'import2', title: 'Imported Document 2', source: 'external-api' },
    { id: 'import3', title: 'Imported Document 3', source: 'external-api' },
    { id: 'import4', title: 'Imported Document 4', source: 'external-api' },
    { id: 'import5', title: 'Imported Document 5', source: 'external-api' }
  ];
  
  var importDocs = importData.map(function(item) {
    var doc = connection.get('documents', item.id);
    doc.create(item);
    return doc;
  });
  
  importSession.putDocs(importDocs, function(error) {
    if (!error) {
      console.log('   ✓ Imported ' + importDocs.length + ' documents to batch');
      console.log('   Processing import validation...');
      
      // Simulate validation delay
      setTimeout(function() {
        importSession.flush(function() {
          console.log('   ✓ Import batch committed to storage');
          importSession.end();
        });
      }, 300);
    }
  });

  // Use Case 2: Periodic Auto-Save
  setTimeout(function() {
    console.log('\n2. Periodic Auto-Save Use Case:');
    
    var autoSaveInterval;
    var pendingChanges = [];
    
    // Simulate user making changes
    var simulateUserChanges = function() {
      var changeId = 'change_' + Date.now() + '_' + Math.random();
      var doc = connection.get('documents', changeId);
      doc.create({
        title: 'User Change ' + changeId,
        content: 'User generated content',
        lastModified: new Date().toISOString()
      });
      pendingChanges.push(doc);
      console.log('   User made change: ' + changeId + ' (queue: ' + pendingChanges.length + ')');
    };
    
    // Periodic auto-save function
    var performAutoSave = function() {
      if (pendingChanges.length === 0) return;
      
      console.log('   🔄 Auto-saving ' + pendingChanges.length + ' pending changes...');
      var docsToSave = pendingChanges.slice(); // Copy the array
      pendingChanges = []; // Clear pending changes
      
      durableStore.putDocsBulk(docsToSave, function(error) {
        if (!error) {
          console.log('   ✓ Auto-saved ' + docsToSave.length + ' changes');
        }
      });
    };
    
    // Simulate user activity
    simulateUserChanges();
    setTimeout(simulateUserChanges, 200);
    setTimeout(simulateUserChanges, 400);
    setTimeout(simulateUserChanges, 600);
    
    // Set up auto-save every 800ms
    autoSaveInterval = setInterval(performAutoSave, 800);
    
    // Clean up after demo
    setTimeout(function() {
      clearInterval(autoSaveInterval);
      performAutoSave(); // Final save
      console.log('   ✓ Auto-save demo completed');
    }, 2500);
  }, 1500);

  // Use Case 3: Transaction-like Operations
  setTimeout(function() {
    console.log('\n3. Transaction-like Operations:');
    
    var transaction = durableStore.startBatchSession();
    
    // Simulate a multi-document transaction
    var userId = 'user_transaction_' + Date.now();
    var orderId = 'order_transaction_' + Date.now();
    
    var userDoc = connection.get('users', userId);
    var orderDoc = connection.get('orders', orderId);
    var inventoryDoc = connection.get('inventory', 'item_123');
    
    userDoc.create({
      name: 'Transaction User',
      email: 'user@transaction.test',
      credits: 100
    });
    
    orderDoc.create({
      userId: userId,
      item: 'item_123',
      quantity: 2,
      total: 50,
      status: 'pending'
    });
    
    inventoryDoc.create({
      itemId: 'item_123',
      quantity: 98, // Reduced by 2
      reserved: 2
    });
    
    // Add all documents to transaction
    transaction.putDocs([userDoc, orderDoc, inventoryDoc], function(error) {
      if (error) {
        console.log('   ❌ Transaction failed, rolling back...');
        transaction.end(); // Don't flush on error
        return;
      }
      
      console.log('   ✓ Transaction prepared (3 documents)');
      console.log('   Validating transaction...');
      
      // Simulate validation
      setTimeout(function() {
        console.log('   ✓ Transaction validated');
        transaction.flush(function(flushError) {
          if (flushError) {
            console.log('   ❌ Transaction commit failed');
          } else {
            console.log('   ✓ Transaction committed successfully');
          }
          transaction.end();
        });
      }, 200);
    });
  }, 4000);
}

// ===============================
// Main Example
// ===============================

async function runBatchWritingExample() {
  console.log('ShareDB Batch Writing Control Example\n');
  console.log('This example demonstrates caller-controlled batch writing capabilities.\n');

  try {
    var setup = await setupBatchWritingDemo();
    var durableStore = setup.durableStore;
    var connection = setup.connection;

    // Wait for DurableStore to be ready
    durableStore.on('ready', function() {
      console.log('DurableStore ready - batch writing features available!\n');
      
      // Run demonstrations
      demonstrateBatchSessions(durableStore, connection);
      setTimeout(function() { demonstrateBulkWriteMethods(durableStore, connection); }, 3000);
      setTimeout(function() { compareBatchingStrategies(durableStore, connection); }, 6000);
      setTimeout(function() { demonstrateRealWorldUseCases(durableStore, connection); }, 10000);
    });

    // Initialize the DurableStore
    durableStore.initialize();

  } catch (error) {
    console.error('Error setting up batch writing example:', error);
  }
}

// Run the example
runBatchWritingExample();

// ===============================
// Export for use in other files
// ===============================

module.exports = {
  setupBatchWritingDemo: setupBatchWritingDemo,
  demonstrateBatchSessions: demonstrateBatchSessions,
  demonstrateBulkWriteMethods: demonstrateBulkWriteMethods,
  compareBatchingStrategies: compareBatchingStrategies,
  demonstrateRealWorldUseCases: demonstrateRealWorldUseCases
};