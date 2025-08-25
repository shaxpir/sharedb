/**
 * ShareDB Connection-Level Batch Control Example
 * 
 * This example demonstrates the clean, Connection-level API for controlling
 * batch writing behavior directly through the connection object.
 * 
 * Key Benefits:
 * - Simple, intuitive API at the Connection level
 * - Direct control over auto-flush behavior
 * - Clean flow from Connection → DurableStore → Storage
 * - No complex session management
 */

var ShareDB = require('../lib/sharedb');
var Connection = require('../lib/client/connection');
var DurableStore = require('../lib/client/durable-store');
var SqliteStorage = require('../lib/client/storage/sqlite-storage');
var CollectionPerTableStrategy = require('../lib/client/storage/schema/collection-per-table-strategy');

// ===============================
// Basic Auto-Flush Control
// ===============================

function demonstrateAutoFlushControl(connection) {
  console.log('\n=== Auto-Flush Control Demo ===\n');

  // Check current auto-flush setting
  console.log('1. Current auto-flush setting: ' + connection.isAutoFlush());
  
  // Create some test documents
  var docs = [];
  for (var i = 0; i < 5; i++) {
    var doc = connection.get('documents', 'demo_' + i);
    doc.create({
      title: 'Demo Document ' + i,
      content: 'This is a demo document',
      timestamp: Date.now()
    });
    docs.push(doc);
  }

  // Disable auto-flush
  console.log('2. Disabling auto-flush...');
  connection.setAutoFlush(false);
  console.log('   Auto-flush enabled: ' + connection.isAutoFlush());

  // Add documents without auto-flushing
  console.log('3. Adding documents without auto-flush...');
  var startTime = Date.now();
  var remaining = docs.length;

  docs.forEach(function(doc) {
    connection.putDoc(doc, function(error) {
      if (error) {
        console.error('   Error adding doc:', error);
        return;
      }
      
      remaining--;
      if (remaining === 0) {
        var addTime = Date.now() - startTime;
        console.log('   ✓ Added ' + docs.length + ' documents in ' + addTime + 'ms');
        console.log('   Queue size: ' + connection.getWriteQueueSize());
        console.log('   Has pending writes: ' + connection.hasPendingWrites());
        
        // Manually flush
        console.log('4. Manually flushing writes...');
        var flushStart = Date.now();
        
        connection.flushWrites(function(flushError) {
          if (flushError) {
            console.error('   Flush error:', flushError);
            return;
          }
          
          var flushTime = Date.now() - flushStart;
          console.log('   ✓ Flushed writes in ' + flushTime + 'ms');
          console.log('   Queue size after flush: ' + connection.getWriteQueueSize());
          
          // Re-enable auto-flush
          console.log('5. Re-enabling auto-flush...');
          connection.setAutoFlush(true);
          console.log('   Auto-flush enabled: ' + connection.isAutoFlush());
        });
      }
    });
  });
}

// ===============================
// Bulk Operations
// ===============================

function demonstrateBulkOperations(connection) {
  console.log('\n=== Bulk Operations Demo ===\n');

  // Example 1: Simple bulk write
  console.log('1. Simple Bulk Write:');
  
  var bulkDocs = [];
  for (var i = 100; i < 110; i++) {
    var doc = connection.get('documents', 'bulk_' + i);
    doc.create({
      title: 'Bulk Document ' + i,
      type: 'bulk-demo',
      index: i,
      created: new Date().toISOString()
    });
    bulkDocs.push(doc);
  }
  
  var startTime = Date.now();
  connection.putDocsBulk(bulkDocs, function(error) {
    if (error) {
      console.error('   Bulk write error:', error);
      return;
    }
    
    var bulkTime = Date.now() - startTime;
    console.log('   ✓ Bulk wrote ' + bulkDocs.length + ' documents in ' + bulkTime + 'ms');
  });

  // Example 2: Multiple document batches
  setTimeout(function() {
    console.log('\n2. Multiple Document Batches:');
    
    // Prepare multiple batches
    var batch1 = [], batch2 = [], batch3 = [];
    
    for (var j = 200; j < 205; j++) {
      var doc = connection.get('documents', 'batch1_' + j);
      doc.create({ title: 'Batch 1 Doc ' + j, batch: 1 });
      batch1.push(doc);
    }
    
    for (var k = 210; k < 215; k++) {
      var doc2 = connection.get('documents', 'batch2_' + k);
      doc2.create({ title: 'Batch 2 Doc ' + k, batch: 2 });
      batch2.push(doc2);
    }
    
    for (var l = 220; l < 225; l++) {
      var doc3 = connection.get('documents', 'batch3_' + l);
      doc3.create({ title: 'Batch 3 Doc ' + l, batch: 3 });
      batch3.push(doc3);
    }
    
    // Add batches using putDocs (queues multiple docs)
    console.log('   Adding batch 1...');
    connection.setAutoFlush(false); // Disable auto-flush
    
    connection.putDocs(batch1, function() {
      console.log('   ✓ Batch 1 added to queue (' + batch1.length + ' docs)');
      console.log('   Queue size: ' + connection.getWriteQueueSize());
      
      connection.putDocs(batch2, function() {
        console.log('   ✓ Batch 2 added to queue (' + batch2.length + ' docs)');
        console.log('   Queue size: ' + connection.getWriteQueueSize());
        
        connection.putDocs(batch3, function() {
          console.log('   ✓ Batch 3 added to queue (' + batch3.length + ' docs)');
          console.log('   Queue size: ' + connection.getWriteQueueSize());
          
          // Flush all batches at once
          console.log('   Flushing all batches...');
          var batchFlushStart = Date.now();
          
          connection.flushWrites(function() {
            var batchFlushTime = Date.now() - batchFlushStart;
            console.log('   ✓ All batches flushed in ' + batchFlushTime + 'ms');
            console.log('   Final queue size: ' + connection.getWriteQueueSize());
            
            // Re-enable auto-flush
            connection.setAutoFlush(true);
          });
        });
      });
    });
  }, 1000);
}

// ===============================
// Real-world Use Cases
// ===============================

function demonstrateRealWorldUseCases(connection) {
  console.log('\n=== Real-world Use Cases ===\n');

  // Use Case 1: Data Import
  console.log('1. Data Import Use Case:');
  
  var importData = [
    { id: 'import_1', title: 'Import Doc 1', source: 'external-api', type: 'article' },
    { id: 'import_2', title: 'Import Doc 2', source: 'external-api', type: 'article' },
    { id: 'import_3', title: 'Import Doc 3', source: 'external-api', type: 'blog' },
    { id: 'import_4', title: 'Import Doc 4', source: 'external-api', type: 'blog' },
    { id: 'import_5', title: 'Import Doc 5', source: 'external-api', type: 'news' }
  ];
  
  // Disable auto-flush for efficient import
  connection.setAutoFlush(false);
  
  var importDocs = importData.map(function(item) {
    var doc = connection.get('documents', item.id);
    doc.create(item);
    return doc;
  });
  
  console.log('   Importing ' + importDocs.length + ' documents...');
  var importStart = Date.now();
  
  connection.putDocs(importDocs, function(error) {
    if (error) {
      console.error('   Import error:', error);
      return;
    }
    
    console.log('   ✓ Documents queued for import');
    console.log('   Validating import...');
    
    // Simulate validation delay
    setTimeout(function() {
      console.log('   ✓ Import validated, committing...');
      
      connection.flushWrites(function() {
        var importTime = Date.now() - importStart;
        console.log('   ✓ Import completed in ' + importTime + 'ms');
        connection.setAutoFlush(true); // Re-enable auto-flush
      });
    }, 300);
  });

  // Use Case 2: Periodic Auto-Save
  setTimeout(function() {
    console.log('\n2. Periodic Auto-Save Use Case:');
    
    var userChanges = [];
    var autoSaveInterval;
    
    // Disable auto-flush for controlled saving
    connection.setAutoFlush(false);
    
    // Simulate user making changes
    var simulateChange = function(changeIndex) {
      var doc = connection.get('documents', 'user_change_' + changeIndex);
      doc.create({
        title: 'User Change ' + changeIndex,
        content: 'User generated content for change ' + changeIndex,
        timestamp: Date.now()
      });
      
      connection.putDoc(doc);
      userChanges.push(doc);
      console.log('   User change ' + changeIndex + ' queued (total: ' + userChanges.length + ')');
    };
    
    // Auto-save function
    var performAutoSave = function() {
      if (connection.hasPendingWrites()) {
        var queueSize = connection.getWriteQueueSize();
        console.log('   🔄 Auto-saving ' + queueSize + ' pending changes...');
        
        connection.flushWrites(function() {
          console.log('   ✓ Auto-save completed');
        });
      }
    };
    
    // Simulate user activity
    simulateChange(1);
    setTimeout(function() { simulateChange(2); }, 200);
    setTimeout(function() { simulateChange(3); }, 400);
    setTimeout(function() { simulateChange(4); }, 600);
    setTimeout(function() { simulateChange(5); }, 800);
    
    // Set up auto-save every 1 second
    autoSaveInterval = setInterval(performAutoSave, 1000);
    
    // Clean up after demo
    setTimeout(function() {
      clearInterval(autoSaveInterval);
      performAutoSave(); // Final save
      connection.setAutoFlush(true); // Re-enable auto-flush
      console.log('   ✓ Auto-save demo completed');
    }, 3500);
  }, 2000);

  // Use Case 3: Atomic Operations
  setTimeout(function() {
    console.log('\n3. Atomic Operations Use Case:');
    
    var transactionId = 'tx_' + Date.now();
    
    // Create related documents that should be saved together
    var userDoc = connection.get('users', transactionId + '_user');
    var profileDoc = connection.get('profiles', transactionId + '_profile');
    var settingsDoc = connection.get('settings', transactionId + '_settings');
    
    userDoc.create({
      username: 'atomic_user',
      email: 'user@atomic.test',
      created: new Date().toISOString()
    });
    
    profileDoc.create({
      userId: transactionId + '_user',
      displayName: 'Atomic User',
      bio: 'Testing atomic operations'
    });
    
    settingsDoc.create({
      userId: transactionId + '_user',
      theme: 'dark',
      notifications: true,
      privacy: 'private'
    });
    
    console.log('   Creating atomic operation with 3 related documents...');
    connection.setAutoFlush(false);
    
    var atomicDocs = [userDoc, profileDoc, settingsDoc];
    connection.putDocs(atomicDocs, function(error) {
      if (error) {
        console.log('   ❌ Atomic operation failed, not committing...');
        // In a real app, you might clear the queue here
        return;
      }
      
      console.log('   ✓ Atomic operation prepared (' + atomicDocs.length + ' documents)');
      console.log('   Validating atomic operation...');
      
      // Simulate validation
      setTimeout(function() {
        console.log('   ✓ Atomic operation validated');
        console.log('   Committing atomic operation...');
        
        connection.flushWrites(function() {
          console.log('   ✓ Atomic operation committed successfully');
          connection.setAutoFlush(true);
        });
      }, 200);
    });
  }, 6000);
}

// ===============================
// Main Example
// ===============================

async function runConnectionBatchControlExample() {
  console.log('ShareDB Connection-Level Batch Control Example\n');
  console.log('This demonstrates clean, intuitive batch control at the Connection level.\n');

  try {
    // Create a simple in-memory setup for demonstration
    var backend = new ShareDB();
    var connection = backend.connect();
    
    // For this demo, we'll simulate the DurableStore functionality
    // In a real application, you would set up the full DurableStore + Storage stack
    
    console.log('Connection ready for batch control demonstrations!\n');
    
    // Run demonstrations
    demonstrateAutoFlushControl(connection);
    setTimeout(function() { demonstrateBulkOperations(connection); }, 2000);
    setTimeout(function() { demonstrateRealWorldUseCases(connection); }, 5000);
    
  } catch (error) {
    console.error('Error setting up connection batch control example:', error);
  }
}

// ===============================
// API Summary
// ===============================

function printAPISummary() {
  setTimeout(function() {
    console.log('\n\n=== Connection Batch Control API Summary ===\n');
    console.log('// Basic auto-flush control');
    console.log('connection.setAutoFlush(false);         // Disable auto-flush');
    console.log('connection.isAutoFlush();               // Check current setting');
    console.log('');
    console.log('// Adding documents to queue');
    console.log('connection.putDoc(doc, callback);       // Add single document');
    console.log('connection.putDocs([docs], callback);   // Add multiple documents');
    console.log('');
    console.log('// Bulk operations');
    console.log('connection.putDocsBulk([docs], callback); // Bulk write with flush');
    console.log('');
    console.log('// Manual flushing');
    console.log('connection.flushWrites(callback);       // Flush pending writes');
    console.log('');
    console.log('// Queue inspection');
    console.log('connection.getWriteQueueSize();         // Current queue size');
    console.log('connection.hasPendingWrites();          // Has pending writes?');
    console.log('');
    console.log('// Restore auto-flush');
    console.log('connection.setAutoFlush(true);          // Re-enable auto-flush');
    console.log('\nClean, simple, and powerful! 🚀');
  }, 15000);
}

// Run the example
runConnectionBatchControlExample();
printAPISummary();

// ===============================
// Export for use in other files
// ===============================

module.exports = {
  demonstrateAutoFlushControl: demonstrateAutoFlushControl,
  demonstrateBulkOperations: demonstrateBulkOperations,
  demonstrateRealWorldUseCases: demonstrateRealWorldUseCases,
  runConnectionBatchControlExample: runConnectionBatchControlExample
};