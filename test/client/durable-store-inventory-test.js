var Backend = require('../../lib/backend');
var DurableStore = require('../../lib/client/durable-store');
var InMemoryStorage = require('../../lib/client/storage/in-memory-storage');
var expect = require('chai').expect;

describe('DurableStore Inventory Management', function() {
  var backend;
  var connection;

  beforeEach(function(done) {
    backend = new Backend();
    var storage = new InMemoryStorage({ debug: false });
    connection = backend.connect();
    connection.durableStore = new DurableStore(storage, { debug: false });
    connection.durableStore.on('ready', done);
    connection.durableStore.initialize();
  });

  afterEach(function(done) {
    connection.close();
    backend.close(done);
  });

  // Helper: wait for all durable store writes to settle
  function whenPersisted(callback) {
    if (!connection.durableStore.hasDocsInWriteQueue()) {
      // Wait a tick for any ack-triggered persists to be queued
      return setTimeout(function() {
        if (!connection.durableStore.hasDocsInWriteQueue()) {
          return callback();
        }
        connection.durableStore.on('no persist pending', callback);
      }, 20);
    }
    connection.durableStore.on('no persist pending', callback);
  }

  it('should maintain inventory when documents are stored', function(done) {
    var doc = connection.get('items', 'item1');
    doc.create({name: 'Test Item'}, function(err) {
      if (err) return done(err);
      whenPersisted(function() {
        var collections = connection.durableStore.inventory.payload.collections;
        expect(collections.items).to.exist;
        expect(collections.items.item1).to.exist;
        expect(collections.items.item1.v).to.equal(1);
        expect(collections.items.item1.p).to.be.false;
        done();
      });
    });
  });

  it('should track pending operations in inventory', function(done) {
    var doc = connection.get('items', 'item2');
    doc.create({value: 0}, function(err) {
      if (err) return done(err);
      // Pause to queue ops without sending
      doc.pause();
      doc.submitOp([{p: ['value'], na: 1}]);
      doc.submitOp([{p: ['value'], na: 1}]);
      whenPersisted(function() {
        var collections = connection.durableStore.inventory.payload.collections;
        expect(collections.items.item2.p).to.be.true;
        done();
      });
    });
  });

  it('should correctly use isDocInInventory', function(done) {
    expect(connection.durableStore.isDocInInventory('items', 'item3')).to.be.false;
    var doc = connection.get('items', 'item3');
    doc.create({test: true}, function(err) {
      if (err) return done(err);
      whenPersisted(function() {
        expect(connection.durableStore.isDocInInventory('items', 'item3')).to.be.true;
        expect(connection.durableStore.isDocInInventory('items', 'item3', 1)).to.be.true;
        expect(connection.durableStore.isDocInInventory('items', 'item3', 2)).to.be.false;
        expect(connection.durableStore.isDocInInventory('items', 'nonexistent')).to.be.false;
        done();
      });
    });
  });

  it('should handle multiple documents in batch', function(done) {
    var doc1 = connection.get('posts', 'post1');
    var doc2 = connection.get('posts', 'post2');
    var doc3 = connection.get('comments', 'comment1');
    var count = 0;
    function afterCreate(err) {
      if (err) return done(err);
      count++;
      if (count < 3) return;
      whenPersisted(function() {
        var collections = connection.durableStore.inventory.payload.collections;
        expect(collections.posts).to.exist;
        expect(Object.keys(collections.posts)).to.have.lengthOf(2);
        expect(collections.comments).to.exist;
        expect(Object.keys(collections.comments)).to.have.lengthOf(1);
        done();
      });
    }
    doc1.create({title: 'Post 1'}, afterCreate);
    doc2.create({title: 'Post 2'}, afterCreate);
    doc3.create({content: 'Comment 1'}, afterCreate);
  });

  it('should update inventory version on document updates', function(done) {
    var doc = connection.get('items', 'item4');
    doc.create({value: 0}, function(err) {
      if (err) return done(err);
      whenPersisted(function() {
        var collections = connection.durableStore.inventory.payload.collections;
        expect(collections.items.item4.v).to.equal(1);
        doc.submitOp([{p: ['value'], na: 5}], function(err) {
          if (err) return done(err);
          whenPersisted(function() {
            expect(collections.items.item4.v).to.equal(2);
            done();
          });
        });
      });
    });
  });
});
