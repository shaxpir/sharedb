var Backend = require('../../lib/backend');
var Connection = require('../../lib/client/connection');
var StreamSocket = require('../../lib/stream-socket');

var sinon = require('sinon');
var expect = require('chai').expect;

var async = require('async');

var types = require('../../lib/types');
var json1 = require('ot-json1');
types.register(json1.type);

const checkError = function(done, checkFunc) {
  return function() {
    try {
      console.log("Test complete, running checks...");
      checkFunc();
      console.log("Test done successfully?");
      done();
    }
    catch(e) {
      console.log("Test done with error");
      done(e);
    }
  };
};

const deleteDatabase = function(namespace, callback) {
  var dbName = 'sharedb_' + namespace
  var request = window.indexedDB.deleteDatabase(dbName);
  request.onsuccess = function(event) {
    console.log("Deleted IndexedDB database: ", dbName);
    callback();
  };
  request.onerror = function(event) {
    callback("ERROR", event);
  };
};

describe('DurableStore', function() {
  var backend;
  var connection;
  var socket;
  var doc;

  var durableStoreNamespace = '__test__';

  afterEach(function(done) {
    const request = connection.durableStore.db.close();
    done();
  });

  beforeEach(function(done) {
    const currentTest = this.currentTest;

    backend = new Backend();
    socket = new StreamSocket();
    socket._open();
    backend.listen(socket.stream);
    this.timeout(60*1000)

    async.series([
      function(next) {
        deleteDatabase(durableStoreNamespace, next);
      },
      // Initialize connection and DurableStore
      function(next) {
        connection = new Connection(socket, {durableStore: {namespace: durableStoreNamespace, onReadyCallback: next}});

        // Log send/receive
        connection.on('receive', function(message) {
          console.log(`Client <-- Server: ${JSON.stringify(message.data)}`);
        });
        connection.on('send', function(message) {
          console.log(`Client --> Server: ${JSON.stringify(message)}`);
        });
        //connection.debug = true;
      },
      // Initialize and create doc
      function(next) {
        doc = connection.get('books', 'book_1');

        // Log persist requests
        doc.on('enqueue persist', function(params) {
          console.log(`-----\n_putToDurableStore requested! Reason: ${params.reason}`, JSON.stringify(params), '\n-----\n\n');
        });

        doc.create({title: 'Dune', body_text: ''}, json1.type.uri, function(error) {
          return next(error);
        });
      },
      function(next) {
        connection.durableStore.once('no persist pending', next);
      },
      function(next) {
        console.log(" ----- TEST BEGIN: ----- ", currentTest.title);
        next();
      }
    ], done);
  });

  it('persists Docs', function(done) {
    connection.durableStore.getDoc('books', 'book_1', function(record) {
      expect(record.data).to.deep.equal({title: 'Dune', body_text: ''});
      expect(record.version).to.equal(1);
      done();
    });
  });

  it('persists inflightOp', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    doc.submitOp(['title', {r: 'Dune', i: 'Home'}], function() {
      connection.durableStore.once('no persist pending', function() {
        var call = spy.getCall(0);
        expect(call.args[0].docs.length).to.equal(1);

        var record = call.args[0].docs[0];
        expect(record.id).to.equal('books/book_1');
        expect(record.payload.version).to.equal(1);
        expect(record.payload.inflightOp.op).to.deep.equal(['title', {r: 'Dune', i: 'Home'}]);
        done();
      });
    });
  });

  it('persists pendingOps', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    // Submit two ops, without composing them together, to force one inflightOp and one pendingOp...
    doc.preventCompose = true;

    // This will cause a flush and persistence on next tick
    console.log("About to submit 1st op" );
    doc.submitOp(['title', {r: 'Dune', i: 'Home'}], function() {
      console.log("1st op ACK");
    });
    console.log("1st op submitted." );

    // This will add an op to pendingOps and also trigger a flush on next tick...
    // But we want both of these flushes to result in one persist
    console.log("About to submit 2nd op" );
    doc.submitOp(['body_text', {r: '', i: 'She emerged like an unfinished line of poetry.'}], checkError(done, function() {
      console.log("Second op ACK" );
      var payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

      expect(payloads).to.have.lengthOf(2);

      expect(payloads[0].version).to.equal(1);
      expect(payloads[0].pendingOps).to.have.lengthOf(1);
      expect(payloads[0].pendingOps[0].op).to.deep.equal(['body_text', {r: '',     i: 'She emerged like an unfinished line of poetry.'}]);
      expect(payloads[0].inflightOp   .op).to.deep.equal(['title',     {r: 'Dune', i: 'Home'}]);

      expect(payloads[1].version).to.equal(2);
      expect(payloads[1].pendingOps).to.be.empty;
      expect(payloads[1].inflightOp   .op).to.deep.equal(['body_text', {r: '',     i: 'She emerged like an unfinished line of poetry.'}]);
    }));
    console.log("2nd op submitted...");
  });

  it('persists only once when submitting multiple consecutive ops synchronously', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    doc.submitOp(['title', {r: 'Dune', i: 'Home'}]);
    doc.submitOp(['body_text', {r: '', i: 'body'}], function() {
      doc.durableStore.once('no persist pending', checkError(done, function() {
        var payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

        // First persistence is the inflight composed op, second is after ACK
        expect(payloads.length).to.equal(2);

        expect(payloads[0].inflightOp).to.not.be.null;
        expect(payloads[0].inflightOp.op).to.deep.equal([
          ['body_text', {r: '',     i: 'body'}],
          ['title',     {r: 'Dune', i: 'Home'}]
        ]);
        expect(payloads[0].pendingOps).to.be.empty;

        expect(payloads[1].inflightOp).to.be.null;
        expect(payloads[1].pendingOps).to.be.empty;
      }));
    });
  });

  it('persists only once when submitting multiple consecutive ops synchronously while offline', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    doc.preventCompose = true;

    connection.close();

    doc.submitOp(['body_text', {r: '', i: 'offline op 1'}]);
    doc.submitOp(['title', {r: 'Dune', i: 'offline op 2'}]);

    connection.durableStore.once('no persist pending', checkError(done, function() {
      const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

      for (let payload of payloads)
        console.log(`Payload PendingOps: ${JSON.stringify(payload.pendingOps.map(p => p.op))}`);

      expect(payloads.length).to.equal(1);
      expect(payloads[0].inflightOp).to.be.null;
      expect(payloads[0].pendingOps).to.have.lengthOf(2);
      expect(doc.data).to.deep.equal({title: 'offline op 2', body_text: 'offline op 1'});

      connection.durableStore.once('no persist pending', function() {
        done("Error: only one persist expected.");
      });

    }));
  });

  it('persists twice when submitting ops on separate ticks while offline', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    doc.preventCompose = true;

    connection.close();

    doc.submitOp(['body_text', {r: '', i: 'offline op 1'}]);
    setTimeout( function() {
      doc.submitOp(['title', {r: 'Dune', i: 'offline op 2'}]);
    }, 0);

    connection.durableStore.once('persist', function() {
      connection.durableStore.once('persist', checkError(done, function() {
        const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

        expect(payloads.length).to.equal(2);
        expect(payloads[0].inflightOp).to.be.null;
        expect(payloads[0].pendingOps).to.have.lengthOf(1);
        expect(payloads[1].inflightOp).to.be.null;
        expect(payloads[1].pendingOps).to.have.lengthOf(2);
        expect(doc.data).to.deep.equal({title: 'offline op 2', body_text: 'offline op 1'});

      }));
    });
  });

  it('persists after op is acknowledged', function(done) {
    var spy = sinon.spy(connection.durableStore, '_writeRecords');

    doc.submitOp(['title', {r: 'Dune', i: 'Home'}], function() {
      doc.durableStore.once('no persist pending', function() {
        var payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

        expect(payloads.length).to.equal(2);

        // The final persist should have no pendingOp, or inflightOp
        expect(payloads[1].inflightOp).to.be.null;
        expect(payloads[1].pendingOps).to.be.empty;
        expect(payloads[1].version).to.equal(2);
        expect(payloads[1].data).to.deep.equal({'title': 'Home', body_text: ''});
        done();
      });
    });
  });

  it('persists fetches', function(done) {

    // Fresh connection and doc with empty durable store
    var connection2;
    var doc2;
    const emptyNamespace = '__empty__';

    async.series([
      function(next) {
        deleteDatabase(emptyNamespace, next);
      },
      function(next) {
        connection2 = new Connection(socket, {durableStore: {debug: true, namespace: emptyNamespace, onReadyCallback: next}});
      },
      function(next) {
        doc2 = connection2.get('books', 'book_1');
        var persistRequests = [];
        doc2.on('enqueue persist', function(request) {
          persistRequests.push(request);
          console.log(`-----\n_putToDurableStore requested! Reason: ${request.reason}`, JSON.stringify(request), '\n-----\n\n');
        });
        var spy = sinon.spy(connection2.durableStore, '_writeRecords');

        doc2.fetch(function() {
          expect(doc2.data).to.deep.equal({title: 'Dune', body_text: ''});
          expect(doc2.version).to.equal(1);

          connection2.durableStore.once('no persist pending', checkError(next, function() {
            var payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

            expect(payloads).to.have.lengthOf(1);

            expect(payloads[0].version).to.equal(1);
            expect(payloads[0].pendingOps).to.be.empty;
            expect(payloads[0].inflightOp).to.be.null;

            expect(persistRequests).to.have.lengthOf(1);
            expect(persistRequests[0].reason).to.equal('ingestSnapshot');

          }));
        });
      }
    ], done);
  });

  describe('persists throughout op lifecycle', function() {
    it('happy path - local op - ACK: A, B', function(done) {
      // The happy path: submit an op
      //   There will be two persists:
      //     1. With in-flight op, before Connection::sendOp
      //     2. After the op is acknowledged
      //
      //   submitOp()
      //   next tick, the doc will set its inflight-op to the op via Doc::_sendOp()
      //     -- but -- we persist here first before Connection::sendOp()
      //     -- IMPORTANT: the persisted record will have the op's `.src` property set to the connection id
      //   when done persisting, the op is sent via Connection::sendOp(), now we are "in-flight"

      expect(doc.hasPending()).to.equal(false);

      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      doc.submitOp(['body_text', {r: '', i: 'AAA'}], function() {
        connection.durableStore.once('no persist pending', function() {
          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

          expect(payloads.length).to.equal(2);
          expect(payloads[0].inflightOp).not.be.null;
          expect(payloads[0].inflightOp.op).to.deep.equal(['body_text', {r: '', i: 'AAA'}]);

          expect(payloads[1].inflightOp).be.null;
          expect(payloads[1].pendingOps).to.be.empty;

          done();
        })
      });
    });

    it('go offline while inflight: A, C', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      doc.submitOp(['body_text', {r: '', i: 'offline op'}]);
      connection.durableStore.once('no persist pending', function() {

        connection.close();

        connection.durableStore.once('no persist pending', function() {
          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

          expect(payloads.length).to.equal(2);
          expect(payloads[0].inflightOp).to.not.be.null;
          expect(payloads[0].pendingOps).to.be.empty;
          expect(payloads[1].inflightOp).be.null;
          expect(payloads[1].pendingOps).to.have.lengthOf(1);

          expect(doc.pendingOps).to.have.lengthOf(1);
          expect(doc.inflightOp).to.be.null;
          expect(doc.data).to.deep.equal({title: 'Dune', body_text: 'offline op'});

          done();
        });
      });
    });

    it('local op while offline then reconnect, D, F, B', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      connection.close();

      doc.submitOp(['body_text', {r: '', i: 'offline op'}]);

      connection.durableStore.once('no persist pending', function() {

        backend.connect(connection, null, function() {

          doc.whenNothingPending(function() {
            connection.durableStore.once('no persist pending', function() {
              const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

              expect(payloads.length).to.equal(3);

              expect(payloads[0].inflightOp).to.be.null;
              expect(payloads[0].pendingOps).to.have.lengthOf(1);

              expect(payloads[1].inflightOp).not.be.null;
              expect(payloads[1].pendingOps).to.be.empty;

              expect(payloads[2].inflightOp).be.null;
              expect(payloads[2].pendingOps).to.be.empty;

              expect(doc.pendingOps).to.be.empty;
              expect(doc.inflightOp).to.be.null;

              done();
            });
          });
        });
      });
    });

    it('local op while offline then another local op: D, E', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      connection.close();

      doc.submitOp(['body_text', {r: '', i: 'offline op'}]);
      connection.durableStore.once('no persist pending', function() {
        doc.submitOp(['title', {r: 'Dune', i: 'Test'}]);
        connection.durableStore.once('no persist pending', function() {

          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

          expect(payloads.length).to.equal(2);
          expect(payloads[0].inflightOp).to.be.null;
          expect(payloads[0].pendingOps).to.have.lengthOf(1);
          expect(payloads[1].inflightOp).be.null;
          expect(payloads[1].pendingOps).to.have.lengthOf(1);

          expect(doc.pendingOps).to.have.lengthOf(1);
          expect(doc.inflightOp).to.be.null;
          expect(doc.data).to.deep.equal({title: 'Test', body_text: 'offline op'});

          done();
        });
      });
    });

    it('local op while offline: D', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      connection.close();

      connection.durableStore.once('no persist pending', function() {
        const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

        expect(payloads.length).to.equal(1);
        expect(payloads[0].inflightOp).to.be.null;
        expect(payloads[0].pendingOps).to.have.lengthOf(1);

        expect(doc.pendingOps).to.have.lengthOf(1);
        expect(doc.inflightOp).to.be.null;

        done();
      });

      doc.submitOp(['body_text', {r: '', i: 'offline op'}]);
    });

    it('go offline while inflight then reconnect: A, C, F, B', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      doc.submitOp(['body_text', {r: '', i: 'offline op'}]);

      async.series([
        // Persist A
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        // Go offline
        function(next) {
          connection.close();
          next();
        },

        // Persist C
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        // Go back online
        function(next) {
          backend.connect(connection, null, function() { next() });
        },

        // Persist F
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        // Wait for ACK, Persist B
        doc.whenNothingPending.bind(doc),
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        // Verify result
        function(next) {
          checkError(next, function() {
            const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

            expect(payloads.length).to.equal(4);
            expect(payloads[0].inflightOp).to.not.be.null;
            expect(payloads[0].pendingOps).to.be.empty;
            expect(payloads[1].inflightOp).be.null;
            expect(payloads[1].pendingOps).to.have.lengthOf(1);
            expect(payloads[2].inflightOp).to.not.be.null;
            expect(payloads[2].pendingOps).to.be.empty;
            expect(payloads[3].inflightOp).to.be.null;
            expect(payloads[3].pendingOps).to.be.empty;

            expect(doc.pendingOps).to.be.empty;
            expect(doc.inflightOp).to.be.null;
            expect(doc.data).to.deep.equal({title: 'Dune', body_text: 'offline op'});
            expect(doc.version).to.equal(2);
          })();
        }
      ], done);
    });

    it('receive remote op: G', function(done) {
      var spy = sinon.spy(connection.durableStore, '_writeRecords');
      var spyPut = sinon.spy(connection.durableStore, 'putDoc');

      var remoteDoc = backend.connect().get('books', 'book_1');
      async.series([
        doc.subscribe.bind(doc),
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          remoteDoc.submitOp(['body_text', {r: '', i: 'remote op'}]);
          next()
        },
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),
        function(next) {
          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);
          const findCaller = (stack) => {
            console.log(stack);
            const m = stack.split("\n")[4].match(/at (\S+) /);
            return m && m[1];
          };
          const puts = spyPut.getCalls().map(c => findCaller(c.stack));

          expect(payloads.length).to.equal(1);
          expect(payloads[0].inflightOp).to.be.null;
          expect(payloads[0].pendingOps).to.be.empty;
          expect(payloads[0].data).to.deep.equal({'title': 'Dune', body_text: 'remote op'});

          next();
        }
      ], done);
    });

    it('local op while inflight: H', function(done) {

      // Don't let the server respond to submitted op
      backend.use('submit', function(request, callback) {
      });

      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      doc.submitOp(['body_text', {r: '', i: 'local op 1'}]);
      connection.durableStore.once('no persist pending', function() {

        expect(doc.inflightOp).to.not.be.null;
        expect(doc.pendingOps).to.be.empty;

        // Submit the next op while we have an inflightOp
        doc.submitOp(['body_text', {r: 'local op 1', i: 'local op 2'}]);

        expect(doc.inflightOp).to.not.be.null;
        expect(doc.pendingOps).to.have.lengthOf(1);

        connection.durableStore.once('no persist pending', function() {
          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

          expect(payloads.length).to.equal(2);
          expect(payloads[0].inflightOp).to.not.be.null;
          expect(payloads[0].pendingOps).to.be.empty;
          expect(payloads[0].data).to.deep.equal({'title': 'Dune', body_text: 'local op 1'});

          expect(payloads[1].inflightOp).to.not.be.null;
          expect(payloads[1].pendingOps).to.have.lengthOf(1);
          expect(payloads[1].data).to.deep.equal({'title': 'Dune', body_text: 'local op 2'});

          done();
        });

      });

    });

    it('ACK while inflight with more pendingOps: H', function(done) {

      // Pause submit with a flag...
      var pauseSubmit = true;
      var fireSubmit;
      backend.use('submit', function(request, callback) {
        if (pauseSubmit) {
          fireSubmit = function() {
            pauseSubmit = false;
            callback();
          };
        } else {
          fireSubmit = null;
          callback();
        }
      });

      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      doc.submitOp(['body_text', {r: '', i: 'local op 1'}]);
      connection.durableStore.once('no persist pending', function() {

        // Submit the next op while we have an inflightOp
        doc.submitOp(['body_text', {r: 'local op 1', i: 'local op 2'}]);

        connection.durableStore.once('no persist pending', function() {

          // Let the first op ACK
          fireSubmit();

          connection.durableStore.once('no persist pending', function() {
            const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

            expect(payloads.length).to.equal(3);

            expect(payloads[0].inflightOp).to.not.be.null;
            expect(payloads[0].inflightOp.op).to.deep.equal(['body_text', {r: '', i: 'local op 1'}]);
            expect(payloads[0].pendingOps).to.be.empty;

            expect(payloads[1].inflightOp).to.not.be.null;
            expect(payloads[1].pendingOps).to.have.lengthOf(1);
            expect(payloads[1].pendingOps[0].op).to.deep.equal(['body_text', {r: 'local op 1', i: 'local op 2'}]);

            expect(payloads[2].inflightOp).to.not.be.null;
            expect(payloads[2].inflightOp.op).to.deep.equal(['body_text', {r: 'local op 1', i: 'local op 2'}]);
            expect(payloads[2].pendingOps).to.be.empty;

            done()
          });
        });
      });
    });

    it('remote op while inflight: H', function(done) {

      // Don't ack first local-op connection
      var submitLocalCallback;
      backend.use('submit', function(request, callback) {
        // Pass through remote op, but not local op
        if (request.op.src !== connection.id) {
          callback();
        }
      });

      var spy = sinon.spy(connection.durableStore, '_writeRecords');

      var remoteDoc = backend.connect().get('books', 'book_1');

      async.series([
        // Subscribe and submit a local op, but don't receive ACK for the local op yet...
        doc.subscribe.bind(doc),
        function(next) {
          doc.submitOp(['body_text', {r: '', i: 'local op'}]);
          next();
        },
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        // Submit a remote op
        remoteDoc.fetch.bind(remoteDoc),
        function(next) {
          remoteDoc.submitOp(['title', {r: 'Dune', i: 'Fun With Remote Ops'}]);
          next();
        },
        connection.durableStore.once.bind(connection.durableStore, 'no persist pending'),

        function(next) {
          const payloads = spy.getCalls().map(c => c.args[0].docs[0].payload);

          expect(payloads.length).to.equal(2);

          expect(payloads[0].inflightOp).to.not.be.null;
          expect(payloads[0].inflightOp.op).to.deep.equal(['body_text', {r: '', i: 'local op'}]);
          expect(payloads[0].pendingOps).to.be.empty;
          expect(payloads[0].data).to.deep.equal({title: 'Dune', body_text: 'local op'});

          expect(payloads[1].inflightOp).to.not.be.null;
          expect(payloads[1].inflightOp.op).to.deep.equal(['body_text', {r: true, i: 'local op'}]);
          expect(payloads[1].pendingOps).to.be.empty;
          expect(payloads[1].data).to.deep.equal({title: 'Fun With Remote Ops', body_text: 'local op'});

          expect(doc.data).to.deep.equal({title: 'Fun With Remote Ops', body_text: 'local op'});
          next();
        }
      ], done);
    });

  });

});