var expect = require('chai').expect;
var ProxyConnection = require('../../../lib/client/proxy/proxy-connection');
var SharedWorkerManager = require('../../../lib/client/proxy/shared-worker-manager');
var Connection = require('../../../lib/client/connection');

describe('ProxyDoc Data Synchronization', function() {
  var proxyConnection1, proxyConnection2;
  var sharedWorkerManager;
  var MockBroadcastChannel;
  var channels = {};
  
  beforeEach(function(done) {
    // Mock BroadcastChannel for testing
    MockBroadcastChannel = function(name) {
      this.name = name;
      this.onmessage = null;
      this.onerror = null;
      
      if (!channels[name]) {
        channels[name] = [];
      }
      channels[name].push(this);
    };
    
    MockBroadcastChannel.prototype.postMessage = function(message) {
      var sourceChannel = this;
      var targetChannels = channels[this.name] || [];
      
      setTimeout(function() {
        targetChannels.forEach(function(channel) {
          if (channel !== sourceChannel && channel.onmessage) {
            channel.onmessage({ data: JSON.parse(JSON.stringify(message)) });
          }
        });
      }, 5); // Small delay to simulate async
    };
    
    MockBroadcastChannel.prototype.close = function() {
      var channelList = channels[this.name] || [];
      var index = channelList.indexOf(this);
      if (index > -1) {
        channelList.splice(index, 1);
      }
    };
    
    global.BroadcastChannel = MockBroadcastChannel;
    
    // Set up SharedWorkerManager and connections
    sharedWorkerManager = new SharedWorkerManager({
      debug: true,
      channelName: 'data-sync-test'
    });
    
    sharedWorkerManager.realConnection = new Connection();
    
    proxyConnection1 = new ProxyConnection({ channelName: 'data-sync-test' });
    proxyConnection2 = new ProxyConnection({ channelName: 'data-sync-test' });
    
    // Wait for connections to be ready
    var readyCount = 0;
    function checkReady() {
      readyCount++;
      if (readyCount === 2) {
        setTimeout(done, 50);
      }
    }
    
    proxyConnection1._messageBroker.on('ready', checkReady);
    proxyConnection2._messageBroker.on('ready', checkReady);
  });
  
  afterEach(function() {
    if (proxyConnection1) proxyConnection1.close();
    if (proxyConnection2) proxyConnection2.close();
    channels = {};
    delete global.BroadcastChannel;
  });
  
  describe('Basic Data Property Access', function() {
    it('should allow direct access to doc.data after create', function(done) {
      var doc1 = proxyConnection1.get('test', 'data-access');
      
      doc1.subscribe(function() {
        doc1.create({
          title: 'Test Document',
          count: 42,
          items: ['first', 'second'],
          nested: { value: 'nested data' }
        });
        
        setTimeout(function() {
          // Should be able to read data directly
          expect(doc1.data).to.exist;
          expect(doc1.data.title).to.equal('Test Document');
          expect(doc1.data.count).to.equal(42);
          expect(doc1.data.items).to.deep.equal(['first', 'second']);
          expect(doc1.data.nested.value).to.equal('nested data');
          
          done();
        }, 100);
      });
    });
    
    it('should synchronize data across multiple tabs', function(done) {
      var doc1 = proxyConnection1.get('test', 'sync-test');
      var doc2 = proxyConnection2.get('test', 'sync-test');
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          // Create document in tab 1
          doc1.create({
            message: 'Hello from tab 1',
            timestamp: Date.now()
          });
          
          setTimeout(function() {
            // Tab 2 should see the same data
            expect(doc2.data).to.exist;
            expect(doc2.data.message).to.equal('Hello from tab 1');
            expect(doc2.data.timestamp).to.equal(doc1.data.timestamp);
            
            done();
          }, 150);
        });
      });
    });
  });
  
  describe('Operation-Based Data Updates', function() {
    it('should update doc.data when applying object insert operations', function(done) {
      var doc1 = proxyConnection1.get('ops', 'object-insert');
      var doc2 = proxyConnection2.get('ops', 'object-insert');
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ title: 'Original Title' }, function() {
            
            // Submit operation to change title
            doc1.submitOp([{
              p: ['title'],
              oi: 'Updated Title'
            }]);
            
            // Immediate optimistic update in doc1
            expect(doc1.data.title).to.equal('Updated Title');
            
            setTimeout(function() {
              // Both tabs should reflect the change
              expect(doc1.data.title).to.equal('Updated Title');
              expect(doc2.data.title).to.equal('Updated Title');
              
              done();
            }, 100);
          });
        });
      });
    });
    
    it('should update doc.data when applying number add operations', function(done) {
      var doc1 = proxyConnection1.get('ops', 'number-add');
      var doc2 = proxyConnection2.get('ops', 'number-add');
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ counter: 0, score: 100 }, function() {
            
            // Increment counter
            doc1.submitOp([{
              p: ['counter'],
              na: 1
            }]);
            
            // Immediate optimistic update
            expect(doc1.data.counter).to.equal(1);
            
            setTimeout(function() {
              // Add to score from different tab
              doc2.submitOp([{
                p: ['score'],
                na: 50
              }]);
              
              setTimeout(function() {
                // Both operations should be reflected in both tabs
                expect(doc1.data.counter).to.equal(1);
                expect(doc1.data.score).to.equal(150);
                expect(doc2.data.counter).to.equal(1);
                expect(doc2.data.score).to.equal(150);
                
                done();
              }, 100);
            }, 50);
          });
        });
      });
    });
    
    it('should update doc.data when applying list operations', function(done) {
      var doc1 = proxyConnection1.get('ops', 'list-ops');
      var doc2 = proxyConnection2.get('ops', 'list-ops');
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ items: ['first'] }, function() {
            
            // Insert item at position 1
            doc1.submitOp([{
              p: ['items', 1],
              li: 'second'
            }]);
            
            // Immediate optimistic update
            expect(doc1.data.items).to.deep.equal(['first', 'second']);
            
            setTimeout(function() {
              // Add another item from tab 2
              doc2.submitOp([{
                p: ['items', 2],
                li: 'third'
              }]);
              
              setTimeout(function() {
                // Both tabs should have all items
                expect(doc1.data.items).to.deep.equal(['first', 'second', 'third']);
                expect(doc2.data.items).to.deep.equal(['first', 'second', 'third']);
                
                done();
              }, 100);
            }, 50);
          });
        });
      });
    });
    
    it('should handle nested path operations', function(done) {
      var doc1 = proxyConnection1.get('ops', 'nested-ops');
      
      doc1.subscribe(function() {
        doc1.create({
          user: {
            profile: {
              name: 'John',
              settings: {
                theme: 'dark'
              }
            }
          }
        }, function() {
          
          // Update nested value
          doc1.submitOp([{
            p: ['user', 'profile', 'name'],
            oi: 'Jane'
          }]);
          
          expect(doc1.data.user.profile.name).to.equal('Jane');
          
          // Update deeply nested value
          doc1.submitOp([{
            p: ['user', 'profile', 'settings', 'theme'],
            oi: 'light'
          }]);
          
          expect(doc1.data.user.profile.settings.theme).to.equal('light');
          
          done();
        });
      });
    });
  });
  
  describe('Complex Operation Sequences', function() {
    it('should handle rapid sequential operations correctly', function(done) {
      var doc1 = proxyConnection1.get('rapid', 'sequence-test');
      
      doc1.subscribe(function() {
        doc1.create({ counter: 0 }, function() {
          
          var operationsToApply = 10;
          var operationsApplied = 0;
          
          // Apply rapid operations
          for (var i = 1; i <= operationsToApply; i++) {
            doc1.submitOp([{
              p: ['counter'],
              na: 1
            }]);
          }
          
          // Counter should immediately show optimistic updates
          expect(doc1.data.counter).to.equal(operationsToApply);
          
          // Listen for op events to track completion
          doc1.on('op', function() {
            operationsApplied++;
            
            if (operationsApplied === operationsToApply) {
              // Final counter should be correct
              expect(doc1.data.counter).to.equal(operationsToApply);
              done();
            }
          });
        });
      });
    });
    
    it('should handle mixed operation types in sequence', function(done) {
      var doc1 = proxyConnection1.get('mixed', 'ops-test');
      
      doc1.subscribe(function() {
        doc1.create({
          title: 'Original',
          count: 0,
          items: [],
          metadata: {}
        }, function() {
          
          // Mixed operation sequence
          var operations = [
            [{ p: ['title'], oi: 'Updated' }],
            [{ p: ['count'], na: 5 }],
            [{ p: ['items', 0], li: 'first item' }],
            [{ p: ['metadata', 'created'], oi: new Date().toISOString() }],
            [{ p: ['items', 1], li: 'second item' }],
            [{ p: ['count'], na: 3 }]
          ];
          
          // Apply all operations
          operations.forEach(function(op) {
            doc1.submitOp(op);
          });
          
          // Verify final state
          expect(doc1.data.title).to.equal('Updated');
          expect(doc1.data.count).to.equal(8);
          expect(doc1.data.items).to.deep.equal(['first item', 'second item']);
          expect(doc1.data.metadata.created).to.be.a('string');
          
          done();
        });
      });
    });
  });
  
  describe('Error Handling', function() {
    it('should handle malformed operations gracefully', function(done) {
      var doc1 = proxyConnection1.get('error', 'malformed-ops');
      
      doc1.subscribe(function() {
        doc1.create({ value: 'test' }, function() {
          
          // Try to apply malformed operation
          var originalData = JSON.parse(JSON.stringify(doc1.data));
          
          try {
            doc1._applyOperationToData([{
              p: ['nonexistent', 'deeply', 'nested'],
              oi: 'should create structure'
            }]);
            
            // Should create nested structure
            expect(doc1.data.nonexistent.deeply.nested).to.equal('should create structure');
            expect(doc1.data.value).to.equal('test'); // Original data preserved
            
          } catch (error) {
            console.log('Expected error for malformed op:', error.message);
          }
          
          done();
        });
      });
    });
    
    it('should preserve data integrity when operation application fails', function(done) {
      var doc1 = proxyConnection1.get('error', 'integrity-test');
      
      doc1.subscribe(function() {
        doc1.create({ 
          validField: 'valid data',
          number: 42 
        }, function() {
          
          var originalData = JSON.parse(JSON.stringify(doc1.data));
          
          // Try to apply operation that might fail
          try {
            doc1._applyOperationToData([{
              p: ['number'],
              na: 'not-a-number' // Invalid number add
            }]);
          } catch (error) {
            // Operation should fail gracefully
            console.log('Handled operation error:', error.message);
          }
          
          // Original valid data should still be intact
          expect(doc1.data.validField).to.equal('valid data');
          
          done();
        });
      });
    });
  });
  
  describe('Data Consistency Verification', function() {
    it('should maintain consistency between doc.data and operation events', function(done) {
      var doc1 = proxyConnection1.get('consistency', 'verify-test');
      var doc2 = proxyConnection2.get('consistency', 'verify-test');
      
      var doc1Operations = [];
      var doc2Operations = [];
      
      doc1.on('op', function(op, source) {
        doc1Operations.push(op);
      });
      
      doc2.on('op', function(op, source) {
        doc2Operations.push(op);
      });
      
      doc1.subscribe(function() {
        doc2.subscribe(function() {
          doc1.create({ value: 0 }, function() {
            
            // Apply several operations
            for (var i = 1; i <= 5; i++) {
              doc1.submitOp([{ p: ['value'], na: i }]);
            }
            
            // Expected final value: 0 + 1 + 2 + 3 + 4 + 5 = 15
            
            setTimeout(function() {
              // Both docs should have same final data
              expect(doc1.data.value).to.equal(15);
              expect(doc2.data.value).to.equal(15);
              
              // Both docs should have received same operations
              expect(doc1Operations).to.have.length(5);
              expect(doc2Operations).to.have.length(5);
              
              done();
            }, 200);
          });
        });
      });
    });
  });
});