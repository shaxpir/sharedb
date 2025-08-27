var Backend = require('../../lib/backend');
var Connection = require('../../lib/client/connection');
var StreamSocket = require('../../lib/stream-socket');
var IndexedDbStorage = require('../../lib/client/storage/indexed-db-storage');
var expect = require('chai').expect;

describe('DurableStore Inventory Management', function() {
  var backend;
  var connection;
  var socket;
  
  beforeEach(function(done) {
    backend = new Backend();
    socket = new StreamSocket();
    socket.on('error', done);
    
    connection = new Connection(socket);
    backend.connect(connection.stream, connection.stream);
    backend.use('receive', function(context, next) {
      // Increase the delay to ensure offline operations
      setTimeout(next, 50);
    });
    
    done();
  });

  afterEach(function(done) {
    connection.close();
    backend.close(done);
  });

  it('should maintain inventory when documents are stored', function(done) {
    // Enable DurableStore
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: '__test_inventory__',
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      // Create a document
      var doc = connection.get('items', 'item1');
      doc.create({name: 'Test Item'}, function(err) {
        if (err) return done(err);
        
        // Check inventory before persistence
        expect(connection.durableStore.inventory).to.exist;
        expect(connection.durableStore.inventory.payload).to.exist;
        expect(connection.durableStore.inventory.payload.collections).to.exist;
        
        // Force flush to ensure persistence
        connection.durableStore.flush(function() {
          // Check inventory after persistence
          var collections = connection.durableStore.inventory.payload.collections;
          expect(collections.items).to.exist;
          expect(collections.items.item1).to.exist;
          expect(collections.items.item1.v).to.equal(1);
          expect(collections.items.item1.p).to.be.false; // No pending ops after flush
          
          done();
        });
      });
    });
  });

  it('should track pending operations in inventory', function(done) {
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: '__test_pending__',
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      var doc = connection.get('items', 'item2');
      
      // Go offline
      socket.close();
      
      // Create document while offline
      doc.create({value: 0}, function(err) {
        if (err) return done(err);
        
        // Submit ops while offline
        doc.submitOp([{p: ['value'], na: 1}]);
        doc.submitOp([{p: ['value'], na: 1}]);
        
        // Force persist with pending ops
        connection.durableStore.flush(function() {
          var collections = connection.durableStore.inventory.payload.collections;
          expect(collections.items.item2.p).to.be.true; // Has pending ops
          expect(collections.items.item2.v).to.equal(3); // Version 3 after create + 2 ops
          
          done();
        });
      });
    });
  });

  it('should correctly use isDocInInventory', function(done) {
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: '__test_isinventory__',
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      // Initially, nothing in inventory
      expect(connection.durableStore.isDocInInventory('items', 'item3')).to.be.false;
      
      var doc = connection.get('items', 'item3');
      doc.create({test: true}, function(err) {
        if (err) return done(err);
        
        connection.durableStore.flush(function() {
          // After persist, should be in inventory
          expect(connection.durableStore.isDocInInventory('items', 'item3')).to.be.true;
          expect(connection.durableStore.isDocInInventory('items', 'item3', 1)).to.be.true;
          expect(connection.durableStore.isDocInInventory('items', 'item3', 2)).to.be.false;
          
          // Non-existent doc should not be in inventory
          expect(connection.durableStore.isDocInInventory('items', 'nonexistent')).to.be.false;
          
          done();
        });
      });
    });
  });

  it('should handle multiple documents in batch', function(done) {
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: '__test_batch__',
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      var doc1 = connection.get('posts', 'post1');
      var doc2 = connection.get('posts', 'post2');
      var doc3 = connection.get('comments', 'comment1');
      
      var count = 0;
      function checkDone() {
        count++;
        if (count === 3) {
          // All docs created, check inventory
          connection.durableStore.flush(function() {
            var collections = connection.durableStore.inventory.payload.collections;
            
            // Check posts collection
            expect(collections.posts).to.exist;
            expect(Object.keys(collections.posts)).to.have.lengthOf(2);
            expect(collections.posts.post1).to.exist;
            expect(collections.posts.post2).to.exist;
            
            // Check comments collection
            expect(collections.comments).to.exist;
            expect(Object.keys(collections.comments)).to.have.lengthOf(1);
            expect(collections.comments.comment1).to.exist;
            
            done();
          });
        }
      }
      
      doc1.create({title: 'Post 1'}, checkDone);
      doc2.create({title: 'Post 2'}, checkDone);
      doc3.create({content: 'Comment 1'}, checkDone);
    });
  });

  it('should update inventory version on document updates', function(done) {
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: '__test_versions__',
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      var doc = connection.get('items', 'item4');
      
      doc.create({value: 0}, function(err) {
        if (err) return done(err);
        
        connection.durableStore.flush(function() {
          var collections = connection.durableStore.inventory.payload.collections;
          expect(collections.items.item4.v).to.equal(1);
          
          // Submit an op to update the document
          doc.submitOp([{p: ['value'], na: 5}], function(err) {
            if (err) return done(err);
            
            connection.durableStore.flush(function() {
              // Version should be updated
              expect(collections.items.item4.v).to.equal(2);
              
              done();
            });
          });
        });
      });
    });
  });

  it('should restore inventory on restart', function(done) {
    var namespace = '__test_restore__';
    
    // First connection with DurableStore
    connection.bindToSocket(socket);
    connection.durableStore = connection.createDurableStore({
      storage: new IndexedDbStorage({
        namespace: namespace,
        debug: false
      })
    });
    
    connection.durableStore.on('ready', function() {
      var doc = connection.get('items', 'persistent1');
      
      doc.create({data: 'test'}, function(err) {
        if (err) return done(err);
        
        connection.durableStore.flush(function() {
          // Close the first connection
          connection.durableStore.close(function() {
            connection.close();
            
            // Create new connection with same namespace
            socket = new StreamSocket();
            connection = new Connection(socket);
            backend.connect(connection.stream, connection.stream);
            connection.bindToSocket(socket);
            
            connection.durableStore = connection.createDurableStore({
              storage: new IndexedDbStorage({
                namespace: namespace,
                debug: false
              })
            });
            
            connection.durableStore.on('ready', function() {
              // Check that inventory was restored
              var collections = connection.durableStore.inventory.payload.collections;
              expect(collections.items).to.exist;
              expect(collections.items.persistent1).to.exist;
              expect(collections.items.persistent1.v).to.equal(1);
              
              done();
            });
          });
        });
      });
    });
  });
});