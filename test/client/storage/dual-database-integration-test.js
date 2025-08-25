var expect = require('chai').expect;
var ExpoSqliteStorage = require('../../../lib/client/storage/expo-sqlite-storage');

describe('Dual Database Integration', function() {
  var storage, mockDb;
  
  // Mock a dual-database SQLite connection like DuiDuiDui app's DatabaseServiceInit
  var MockDualDatabase;
  
  beforeEach(function() {
    // Create a sophisticated mock that simulates dual-database setup
    MockDualDatabase = function() {
      this.queries = [];
      this.responses = {};
      this._closed = false;
    };
    
    MockDualDatabase.prototype.runAsync = function(sql, params) {
      var db = this;
      this.queries.push({ sql: sql, params: params, type: 'run' });
      
      return Promise.resolve({
        changes: 1,
        lastInsertRowId: Math.floor(Math.random() * 1000)
      });
    };
    
    MockDualDatabase.prototype.getFirstAsync = function(sql, params) {
      var db = this;
      this.queries.push({ sql: sql, params: params, type: 'getFirst' });
      
      var key = sql + JSON.stringify(params || []);
      return Promise.resolve(this.responses[key] || null);
    };
    
    MockDualDatabase.prototype.getAllAsync = function(sql, params) {
      var db = this;
      this.queries.push({ sql: sql, params: params, type: 'getAll' });
      
      var key = sql + JSON.stringify(params || []);
      return Promise.resolve(this.responses[key] || []);
    };
    
    MockDualDatabase.prototype.closeAsync = function() {
      this._closed = true;
      return Promise.resolve();
    };
    
    // Helper to set mock responses
    MockDualDatabase.prototype.setResponse = function(sql, params, response) {
      var key = sql + JSON.stringify(params || []);
      this.responses[key] = response;
    };
    
    mockDb = new MockDualDatabase();
  });
  
  afterEach(function() {
    if (storage) {
      storage = null;
    }
  });
  
  describe('Pre-initialized Database Support', function() {
    it('should accept a pre-initialized database connection', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        debug: true
      });
      
      expect(storage.database).to.equal(mockDb);
      expect(storage.db).to.equal(mockDb);
      
      storage.initialize(function() {
        // Should not have tried to open a new database file
        var openQueries = mockDb.queries.filter(function(q) {
          return q.sql.includes('open') || q.sql.includes('ATTACH');
        });
        expect(openQueries.length).to.equal(0);
        
        done();
      });
    });
    
    it('should not close pre-initialized databases', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        debug: true
      });
      
      storage.initialize(function() {
        // Close storage - should not close the database
        storage._storage.adapter.closeDatabase(function() {
          expect(mockDb._closed).to.be.false;
          done();
        });
      });
    });
  });
  
  describe('Schema Prefix Support', function() {
    it('should use schema prefix for table names', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata',
        debug: true
      });
      
      storage.initialize(function() {
        // Check that CREATE TABLE statements use prefixed table names
        var createQueries = mockDb.queries.filter(function(q) {
          return q.sql.includes('CREATE TABLE');
        });
        
        expect(createQueries.length).to.be.greaterThan(0);
        
        var hasUserdataDocs = createQueries.some(function(q) {
          return q.sql.includes('userdata.docs');
        });
        var hasUserdataMeta = createQueries.some(function(q) {
          return q.sql.includes('userdata.meta');
        });
        
        expect(hasUserdataDocs).to.be.true;
        expect(hasUserdataMeta).to.be.true;
        
        done();
      });
    });
    
    it('should use schema prefix in read/write operations', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata',
        debug: true
      });
      
      storage.initialize(function() {
        storage.readRecord('docs', 'test-id', function(error, result) {
          // Check that SELECT query uses prefixed table name
          var selectQueries = mockDb.queries.filter(function(q) {
            return q.type === 'getFirst' && q.sql.includes('SELECT');
          });
          
          expect(selectQueries.length).to.be.greaterThan(0);
          var hasUserdataTable = selectQueries.some(function(q) {
            return q.sql.includes('userdata.docs');
          });
          expect(hasUserdataTable).to.be.true;
          
          done();
        });
      });
    });
  });
  
  describe('Collection Mapping Support', function() {
    it('should use collection mapping callback for table names', function(done) {
      var mappingCallback = function(collection) {
        if (collection === 'docs') return 'userdata.term';
        if (collection === 'meta') return 'userdata.session_meta';
        return 'userdata.' + collection;
      };
      
      storage = new ExpoSqliteStorage({
        database: mockDb,
        collectionMapping: mappingCallback,
        debug: true
      });
      
      expect(storage.getTableName('docs')).to.equal('userdata.term');
      expect(storage.getTableName('__meta__')).to.equal('userdata.session_meta');
      
      storage.initialize(function() {
        // Check that CREATE TABLE statements use mapped table names
        var createQueries = mockDb.queries.filter(function(q) {
          return q.sql.includes('CREATE TABLE');
        });
        
        var hasTermTable = createQueries.some(function(q) {
          return q.sql.includes('userdata.term');
        });
        var hasSessionMetaTable = createQueries.some(function(q) {
          return q.sql.includes('userdata.session_meta');
        });
        
        expect(hasTermTable).to.be.true;
        expect(hasSessionMetaTable).to.be.true;
        
        done();
      });
    });
    
    it('should fall back to schema prefix when no mapping callback provided', function() {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata',
        debug: true
      });
      
      expect(storage.getTableName('docs')).to.equal('userdata.docs');
      expect(storage.getTableName('__meta__')).to.equal('userdata.meta');
    });
    
    it('should use plain table names when no prefix or mapping provided', function() {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        debug: true
      });
      
      expect(storage.getTableName('docs')).to.equal('docs');
      expect(storage.getTableName('__meta__')).to.equal('meta');
    });
  });
  
  describe('Cross-Database Query Support', function() {
    it('should enable cross-database queries by default', function() {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata'
      });
      
      expect(storage.enableCrossDbQueries).to.be.true;
    });
    
    it('should execute cross-database queries', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata',
        debug: true
      });
      
      // Mock a response for the cross-DB query
      var query = 'SELECT u.data, p.translation FROM userdata.term u JOIN phrase p ON u.text = p.text LIMIT 10';
      mockDb.setResponse(query, [], [
        { data: '{"text":"你好"}', translation: 'hello' },
        { data: '{"text":"谢谢"}', translation: 'thank you' }
      ]);
      
      storage.initialize(function() {
        storage.executeCrossDbQuery(query, [], function(error, results) {
          expect(error).to.be.null;
          expect(results).to.be.an('array');
          expect(results.length).to.equal(2);
          expect(results[0].translation).to.equal('hello');
          
          done();
        });
      });
    });
    
    it('should reject cross-database queries when disabled', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        enableCrossDbQueries: false
      });
      
      storage.executeCrossDbQuery('SELECT * FROM builtin.phrase', [], function(error, results) {
        expect(error).to.exist;
        expect(error.message).to.include('Cross-database queries are disabled');
        done();
      });
    });
  });
  
  describe('Statistics and Health', function() {
    it('should provide enhanced statistics with dual-database info', function(done) {
      storage = new ExpoSqliteStorage({
        database: mockDb,
        schemaPrefix: 'userdata',
        collectionMapping: function(collection) { return 'mapped_' + collection; },
        enableCrossDbQueries: true,
        debug: true
      });
      
      storage.initialize(function() {
        storage.getStats(function(error, stats) {
          expect(error).to.be.null;
          expect(stats.schemaPrefix).to.equal('userdata');
          expect(stats.collectionMapping).to.be.a('function');
          expect(stats.enableCrossDbQueries).to.be.true;
          expect(stats.isDualDatabase).to.be.true;
          
          done();
        });
      });
    });
  });
  
  describe('Integration with DuiDuiDiu App Pattern', function() {
    it('should work with DatabaseServiceInit-style setup', function(done) {
      // Simulate the exact pattern from your DuiDuiDui app
      var dualDbConnection = mockDb;
      
      // Your collection mapping for Chinese language learning app
      var collectionMapping = function(collection) {
        var mapping = {
          'docs': 'userdata.term',    // ShareDB docs go to user terms
          'meta': 'userdata.session'  // ShareDB meta goes to user sessions
        };
        return mapping[collection] || 'userdata.' + collection;
      };
      
      storage = new ExpoSqliteStorage({
        database: dualDbConnection,
        collectionMapping: collectionMapping,
        enableCrossDbQueries: true,
        debug: true
      });
      
      storage.initialize(function() {
        // Verify table creation uses the correct mapping
        var createQueries = mockDb.queries.filter(function(q) {
          return q.sql.includes('CREATE TABLE');
        });
        
        var hasUserTermTable = createQueries.some(function(q) {
          return q.sql.includes('userdata.term');
        });
        var hasUserSessionTable = createQueries.some(function(q) {
          return q.sql.includes('userdata.session');
        });
        
        expect(hasUserTermTable).to.be.true;
        expect(hasUserSessionTable).to.be.true;
        
        // Test cross-database query capability
        var crossDbQuery = `
          SELECT u.data as user_term, p.translation 
          FROM userdata.term u 
          JOIN phrase p ON json_extract(u.data, '$.payload.text') = p.text
          WHERE p.learn_rank < 1000
          LIMIT 5
        `;
        
        mockDb.setResponse(crossDbQuery, [], [
          { user_term: '{"payload":{"text":"你好"}}', translation: 'hello' }
        ]);
        
        storage.executeCrossDbQuery(crossDbQuery, [], function(error, results) {
          expect(error).to.be.null;
          expect(results.length).to.equal(1);
          expect(results[0].translation).to.equal('hello');
          
          done();
        });
      });
    });
    
    it('should support existing userdata table schema', function(done) {
      // Test compatibility with your existing (ref TEXT PRIMARY KEY, data JSON) schema
      storage = new ExpoSqliteStorage({
        database: mockDb,
        collectionMapping: function(collection) {
          return 'userdata.' + collection;
        },
        debug: true
      });
      
      storage.initialize(function() {
        // Verify table mapping works correctly
        expect(storage.getTableName('docs')).to.equal('userdata.docs');
        expect(storage.getTableName('__meta__')).to.equal('userdata.meta');
        
        done();
      });
    });
  });
});