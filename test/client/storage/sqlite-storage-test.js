var expect = require('chai').expect;
var SqliteStorage = require('../../../lib/client/storage/sqlite-storage');
var NodeSqliteAdapter = require('../../../lib/client/storage/adapters/node-sqlite-adapter');
var InMemoryStorage = require('../../../lib/client/storage/in-memory-storage');
var DefaultSchemaStrategy = require('../../../lib/client/storage/schema/default-schema-strategy');
var CollectionPerTableStrategy = require('../../../lib/client/storage/schema/collection-per-table-strategy');
var fs = require('fs');
var path = require('path');

describe('SqliteStorage with NodeSqliteAdapter', function() {
  var testDbDir = path.join(__dirname, 'test-dbs');
  var testDbFile = 'test.db';
  var testDbPath = path.join(testDbDir, testDbFile);
  
  beforeEach(function(done) {
    // Clean up test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
    done();
  });
  
  afterEach(function(done) {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    done();
  });
  
  after(function(done) {
    // Clean up test directory
    if (fs.existsSync(testDbDir)) {
      fs.rmdirSync(testDbDir, { recursive: true });
    }
    done();
  });
  
  describe('Basic functionality', function() {
    it('should initialize with NodeSqliteAdapter', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      var storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function(inventory) {
        expect(inventory).to.exist;
        expect(inventory.payload).to.exist;
        expect(inventory.payload.collections).to.deep.equal({});
        
        storage.close(done);
      });
    });
    
    it('should write and read records', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      var storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function() {
        var testDoc = {
          id: 'doc1',
          payload: {
            title: 'Test Document',
            content: 'This is a test'
          }
        };
        
        storage.writeRecords({ docs: [testDoc] }, function(err) {
          expect(err).to.not.exist;
          
          storage.readRecord('docs', 'doc1', function(payload) {
            expect(payload).to.deep.equal(testDoc.payload);
            storage.close(done);
          });
        });
      });
    });
    
    it('should update and read inventory', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      var storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function() {
        storage.updateInventory('posts', 'post1', 1, 'add', function(err) {
          expect(err).to.not.exist;
          
          storage.updateInventory('posts', 'post2', 1, 'add', function(err2) {
            expect(err2).to.not.exist;
            
            storage.readInventory(function(err3, inventory) {
              expect(err3).to.not.exist;
              expect(inventory.payload.collections.posts).to.deep.equal({
                'post1': 1,
                'post2': 1
              });
              
              storage.close(done);
            });
          });
        });
      });
    });
  });
  
  describe('Schema strategies', function() {
    it('should work with DefaultSchemaStrategy', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      var schemaStrategy = new DefaultSchemaStrategy({
        debug: false
      });
      
      var storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: schemaStrategy,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function(inventory) {
        expect(inventory).to.exist;
        expect(schemaStrategy.getInventoryType()).to.equal('json');
        
        storage.close(done);
      });
    });
    
    it('should work with CollectionPerTableStrategy', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      var schemaStrategy = new CollectionPerTableStrategy({
        collectionConfig: {
          'users': {
            indexes: ['email', 'username'],
            encryptedFields: []
          },
          'posts': {
            indexes: ['authorId', 'createdAt'],
            encryptedFields: []
          }
        },
        debug: false
      });
      
      var storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: schemaStrategy,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function(inventory) {
        expect(inventory).to.exist;
        expect(schemaStrategy.getInventoryType()).to.equal('table');
        
        // Write to different collections
        var userDoc = {
          id: 'user1',
          collection: 'users',
          payload: {
            username: 'testuser',
            email: 'test@example.com'
          }
        };
        
        var postDoc = {
          id: 'post1',
          collection: 'posts',
          payload: {
            title: 'Test Post',
            authorId: 'user1',
            createdAt: Date.now()
          }
        };
        
        storage.writeRecords({ docs: [userDoc, postDoc] }, function(err) {
          expect(err).to.not.exist;
          
          // Check that inventory is tracked properly
          storage.readInventory(function(err2, inv) {
            expect(err2).to.not.exist;
            expect(inv.payload.collections).to.have.property('users');
            expect(inv.payload.collections).to.have.property('posts');
            
            storage.close(done);
          });
        });
      });
    });
  });
  
  describe('Encryption support', function() {
    it('should encrypt and decrypt records', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      
      // Simple XOR encryption for testing
      var encryptionKey = 'test-key';
      var xorEncrypt = function(text) {
        var result = '';
        for (var i = 0; i < text.length; i++) {
          result += String.fromCharCode(
            text.charCodeAt(i) ^ encryptionKey.charCodeAt(i % encryptionKey.length)
          );
        }
        return Buffer.from(result).toString('base64');
      };
      
      var xorDecrypt = function(encrypted) {
        var text = Buffer.from(encrypted, 'base64').toString();
        var result = '';
        for (var i = 0; i < text.length; i++) {
          result += String.fromCharCode(
            text.charCodeAt(i) ^ encryptionKey.charCodeAt(i % encryptionKey.length)
          );
        }
        return result;
      };
      
      var schemaStrategy = new DefaultSchemaStrategy({
        useEncryption: true,
        encryptionCallback: xorEncrypt,
        decryptionCallback: xorDecrypt,
        debug: false
      });
      
      var storage = new SqliteStorage({
        adapter: adapter,
        schemaStrategy: schemaStrategy,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function() {
        var secretDoc = {
          id: 'secret1',
          payload: {
            title: 'Secret Document',
            content: 'This is confidential information'
          }
        };
        
        storage.writeRecords({ docs: [secretDoc] }, function(err) {
          expect(err).to.not.exist;
          
          // Read back the document - should be decrypted automatically
          storage.readRecord('docs', 'secret1', function(payload) {
            expect(payload).to.deep.equal(secretDoc.payload);
            
            // Verify it's actually encrypted in the database
            adapter.get('SELECT data FROM docs WHERE id = ?', ['secret1'], function(err2, row) {
              expect(err2).to.not.exist;
              var stored = JSON.parse(row.data);
              expect(stored.encrypted_payload).to.exist;
              expect(stored.payload).to.not.exist;
              
              storage.close(done);
            });
          });
        });
      });
    });
  });
  
  describe('Adapter compatibility', function() {
    it('should support different SQLite implementations', function(done) {
      var adapter = new NodeSqliteAdapter({ debug: false });
      
      expect(adapter.getType()).to.include('node-sqlite');
      expect(adapter.getType()).to.match(/(better-sqlite3|sqlite3)/);
      
      var storage = new SqliteStorage({
        adapter: adapter,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      storage.initialize(function() {
        expect(storage.isReady()).to.be.true;
        storage.close(done);
      });
    });
  });
  
  describe('Comparison with InMemoryStorage', function() {
    it('should have same interface as InMemoryStorage', function(done) {
      var sqliteAdapter = new NodeSqliteAdapter({ debug: false });
      var sqliteStorage = new SqliteStorage({
        adapter: sqliteAdapter,
        dbFileName: testDbFile,
        dbFileDir: testDbDir,
        debug: false
      });
      
      var memoryStorage = new InMemoryStorage({ debug: false });
      
      // Both should have the same methods
      expect(typeof sqliteStorage.initialize).to.equal('function');
      expect(typeof memoryStorage.initialize).to.equal('function');
      
      expect(typeof sqliteStorage.writeRecords).to.equal('function');
      expect(typeof memoryStorage.writeRecords).to.equal('function');
      
      expect(typeof sqliteStorage.readRecord).to.equal('function');
      expect(typeof memoryStorage.readRecord).to.equal('function');
      
      sqliteStorage.close(done);
    });
  });
});