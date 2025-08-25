/**
 * ShareDB Bulk Loading Example
 * 
 * This example demonstrates the new bulk loading capabilities that allow
 * efficient retrieval of multiple documents in a single operation.
 * 
 * Key Performance Benefits:
 * - Single SQL query instead of N individual queries for SQLite storage
 * - Intelligent caching - only fetches uncached documents
 * - Maintains document lifecycle and cache consistency
 */

var ShareDB = require('../lib/sharedb');
var Connection = require('../lib/client/connection');
var DurableStore = require('../lib/client/durable-store');
var SqliteStorage = require('../lib/client/storage/sqlite-storage');
var CollectionPerTableStrategy = require('../lib/client/storage/schema/collection-per-table-strategy');
var ExpoSqliteAdapter = require('../lib/client/storage/adapters/expo-sqlite-adapter');

// ===============================
// Setup Storage with Bulk Capabilities
// ===============================

async function setupStorageWithBulkSupport() {
  // Define collection configuration for optimized bulk queries
  var collectionConfig = {
    users: {
      indexes: ['email', 'department', 'role', 'createdAt'],
      encryptedFields: ['email', 'personalInfo.ssn']
    },
    posts: {
      indexes: ['authorId', 'categoryId', 'createdAt', 'tags'],
      encryptedFields: ['content', 'draftNotes']
    },
    projects: {
      indexes: ['ownerId', 'teamId', 'status', 'priority', 'dueDate'],
      encryptedFields: ['budget', 'confidentialNotes']
    }
  };

  // Create SQLite adapter (example setup - replace with your actual database)
  var adapter = new ExpoSqliteAdapter({
    database: null, // Your database instance would go here
    debug: true
  });

  // Create schema strategy with bulk optimization
  var schemaStrategy = new CollectionPerTableStrategy({
    collectionConfig: collectionConfig,
    useEncryption: true,
    encryptionCallback: function(text) {
      // Your encryption function here
      return Buffer.from(text).toString('base64');
    },
    decryptionCallback: function(encrypted) {
      // Your decryption function here
      return Buffer.from(encrypted, 'base64').toString();
    },
    debug: true
  });

  // Create storage with bulk capabilities
  var storage = new SqliteStorage({
    adapter: adapter,
    schemaStrategy: schemaStrategy,
    debug: true
  });

  return storage;
}

// ===============================
// Bulk Loading Examples
// ===============================

async function demonstrateBulkLoading(connection) {
  console.log('\n=== Bulk Loading Performance Demo ===\n');

  // Example 1: Load team members efficiently
  var teamMemberIds = ['user1', 'user2', 'user3', 'user4', 'user5'];
  
  console.log('Loading ' + teamMemberIds.length + ' team members...');
  var startTime = Date.now();
  
  connection.getBulk('users', teamMemberIds, function(error, teamMembers) {
    if (error) {
      console.error('Error loading team members:', error);
      return;
    }
    
    var loadTime = Date.now() - startTime;
    console.log('✓ Loaded ' + teamMembers.length + ' team members in ' + loadTime + 'ms');
    
    // Access individual team members
    teamMembers.forEach(function(member, index) {
      console.log('  - Team member ' + (index + 1) + ': ' + member.id);
      console.log('    Data available: ' + (member.data ? 'Yes' : 'No (will fetch on access)'));
    });
  });

  // Example 2: Load project documents for dashboard
  var projectIds = ['proj1', 'proj2', 'proj3', 'proj4', 'proj5', 'proj6'];
  
  console.log('\nLoading ' + projectIds.length + ' projects for dashboard...');
  startTime = Date.now();
  
  connection.getBulk('projects', projectIds, function(error, projects) {
    if (error) {
      console.error('Error loading projects:', error);
      return;
    }
    
    var loadTime = Date.now() - startTime;
    console.log('✓ Loaded ' + projects.length + ' projects in ' + loadTime + 'ms');
    
    // Simulate dashboard operations
    projects.forEach(function(project) {
      // Each project is a proper ShareDB Doc with full lifecycle
      if (project.data) {
        console.log('  - Project: ' + project.data.name + ' (' + project.data.status + ')');
      }
    });
  });

  // Example 3: Cache efficiency demonstration
  console.log('\n=== Cache Efficiency Demo ===');
  
  // First call - some documents will be fetched from storage
  var mixedIds = ['user1', 'user6', 'user7', 'user2']; // user1 and user2 might be cached
  
  console.log('First bulk load of mixed users...');
  startTime = Date.now();
  
  connection.getBulk('users', mixedIds, function(error, firstBatch) {
    if (error) {
      console.error('Error in first bulk load:', error);
      return;
    }
    
    var firstLoadTime = Date.now() - startTime;
    console.log('✓ First load completed in ' + firstLoadTime + 'ms');
    
    // Second call - should be much faster due to caching
    console.log('Second bulk load of same users (testing cache)...');
    startTime = Date.now();
    
    connection.getBulk('users', mixedIds, function(error, secondBatch) {
      if (error) {
        console.error('Error in second bulk load:', error);
        return;
      }
      
      var secondLoadTime = Date.now() - startTime;
      console.log('✓ Second load completed in ' + secondLoadTime + 'ms');
      console.log('  Cache efficiency: ' + Math.round(((firstLoadTime - secondLoadTime) / firstLoadTime) * 100) + '% faster');
    });
  });
}

// ===============================
// Performance Comparison
// ===============================

function comparePerformance(connection) {
  console.log('\n=== Performance Comparison: Bulk vs Individual ===\n');
  
  var testIds = ['perf1', 'perf2', 'perf3', 'perf4', 'perf5', 'perf6', 'perf7', 'perf8'];
  
  // Test individual loading (old way)
  console.log('Testing individual loading...');
  var startTime = Date.now();
  var loadedIndividually = [];
  var remaining = testIds.length;
  
  testIds.forEach(function(id) {
    var doc = connection.get('posts', id);
    doc.fetch(function(error) {
      if (!error) {
        loadedIndividually.push(doc);
      }
      
      remaining--;
      if (remaining === 0) {
        var individualTime = Date.now() - startTime;
        console.log('✓ Individual loading: ' + individualTime + 'ms for ' + testIds.length + ' documents');
        
        // Test bulk loading (new way)
        console.log('Testing bulk loading...');
        startTime = Date.now();
        
        connection.getBulk('posts', testIds, function(error, bulkLoaded) {
          if (error) {
            console.error('Error in bulk loading:', error);
            return;
          }
          
          var bulkTime = Date.now() - startTime;
          console.log('✓ Bulk loading: ' + bulkTime + 'ms for ' + testIds.length + ' documents');
          
          var improvement = Math.round(((individualTime - bulkTime) / individualTime) * 100);
          console.log('🚀 Bulk loading is ' + improvement + '% faster!');
          
          console.log('\nBenefits of bulk loading:');
          console.log('  • Single SQL query vs ' + testIds.length + ' separate queries');
          console.log('  • Leverages SQLite indexes for optimal performance');
          console.log('  • Maintains full ShareDB document lifecycle');
          console.log('  • Intelligent cache integration');
        });
      }
    });
  });
}

// ===============================
// Real-world Use Cases
// ===============================

function demonstrateUseCases(connection) {
  console.log('\n=== Real-world Use Cases ===\n');

  // Use Case 1: User Dashboard - Load user profile + related content
  console.log('1. User Dashboard Use Case:');
  var userId = 'currentUser';
  
  // Get user profile first
  var userDoc = connection.get('users', userId);
  userDoc.fetch(function(error) {
    if (error || !userDoc.data) return;
    
    // Get user's project IDs from their profile
    var userProjectIds = userDoc.data.projectIds || [];
    
    if (userProjectIds.length > 0) {
      // Bulk load all user's projects for dashboard
      connection.getBulk('projects', userProjectIds, function(error, projects) {
        if (!error) {
          console.log('   ✓ Loaded user profile + ' + projects.length + ' projects efficiently');
        }
      });
    }
  });

  // Use Case 2: Search Results - Load multiple documents by ID
  console.log('2. Search Results Use Case:');
  var searchResultIds = ['result1', 'result2', 'result3', 'result4'];
  
  connection.getBulk('posts', searchResultIds, function(error, searchResults) {
    if (!error) {
      console.log('   ✓ Search results loaded: ' + searchResults.length + ' posts');
      // Each result is a full ShareDB document ready for real-time collaboration
    }
  });

  // Use Case 3: Related Documents - Load referenced documents
  console.log('3. Related Documents Use Case:');
  var mainDocId = 'article123';
  var mainDoc = connection.get('posts', mainDocId);
  
  mainDoc.fetch(function(error) {
    if (error || !mainDoc.data) return;
    
    // Load all referenced/related documents in one batch
    var relatedIds = mainDoc.data.relatedPosts || [];
    
    if (relatedIds.length > 0) {
      connection.getBulk('posts', relatedIds, function(error, relatedDocs) {
        if (!error) {
          console.log('   ✓ Main article + ' + relatedDocs.length + ' related articles loaded');
        }
      });
    }
  });
}

// ===============================
// Main Example
// ===============================

async function runBulkLoadingExample() {
  console.log('ShareDB Bulk Loading Example\n');
  console.log('This example shows the new bulk loading capabilities for efficient multi-document retrieval.\n');

  try {
    // Setup storage with bulk capabilities
    var storage = await setupStorageWithBulkSupport();
    
    // Create DurableStore with the storage
    var durableStore = new DurableStore(storage, {
      maxBatchSize: 100,
      debug: true
    });

    // Create connection with DurableStore
    var connection = new Connection(null, {
      durableStore: {
        storage: storage,
        debug: true
      }
    });

    // Wait for DurableStore to be ready
    durableStore.on('ready', function() {
      console.log('DurableStore ready - bulk operations available!\n');
      
      // Run demonstrations
      demonstrateBulkLoading(connection);
      setTimeout(function() { comparePerformance(connection); }, 1000);
      setTimeout(function() { demonstrateUseCases(connection); }, 2000);
    });

    // Initialize the DurableStore
    durableStore.initialize();

  } catch (error) {
    console.error('Error setting up bulk loading example:', error);
  }
}

// Run the example
runBulkLoadingExample();

// ===============================
// Export for use in other files
// ===============================

module.exports = {
  setupStorageWithBulkSupport: setupStorageWithBulkSupport,
  demonstrateBulkLoading: demonstrateBulkLoading,
  comparePerformance: comparePerformance,
  demonstrateUseCases: demonstrateUseCases
};