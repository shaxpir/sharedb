// Type definitions for ShareDB
// Project: https://github.com/share/sharedb
// Definitions by: Claude Code <https://claude.ai/code>

/// <reference types="node" />

import { EventEmitter } from 'events';

declare namespace ShareDB {
  // ===============================
  // Core Types and Interfaces
  // ===============================

  type Json = string | number | boolean | null | JsonArray | JsonObject;
  interface JsonArray extends Array<Json> {}
  interface JsonObject { [key: string]: Json }

  // Base operation type - operations are type-specific and vary by OT implementation
  type Op = any;

  // JSON0 Operations (for reference, but Op should remain generic)
  interface Json0Op {
    p: (string | number)[]; // Path
    od?: any; // Old data (object delete)
    oi?: any; // Object insert
    na?: number; // Number add
    li?: any; // List insert  
    ld?: any; // List delete
    lm?: number; // List move
    si?: string; // String insert
    sd?: string; // String delete
    t?: string; // Subtype
  }

  // Rich Text Operations (for reference)
  interface RichTextOp {
    retain?: number;
    insert?: string | object;
    delete?: number;
    attributes?: { [key: string]: any };
  }

  // Text Operations (for reference)
  interface TextOp {
    retain?: number;
    insert?: string;
    delete?: number;
  }

  interface RawOp {
    src?: string;
    seq?: number;
    v?: number;
    op?: Op[]; // Type-specific operations array
    create?: {
      type: string; // OT type name (e.g., 'json0', 'rich-text', 'text')
      data?: any;
    };
    del?: boolean;
    m?: { [key: string]: any }; // Metadata
  }

  interface Snapshot {
    id: string;
    v: number;
    type: string | null;
    data?: any;
    m?: SnapshotMeta;
  }

  interface SnapshotMeta {
    ctime?: number;
    mtime?: number;
    [key: string]: any;
  }

  interface ShareDBError {
    code: number;
    message: string;
  }

  interface Presence {
    [key: string]: any;
  }

  type Callback<T = any> = (error: ShareDBError | null, result?: T) => void;
  type OpCallback = (error: ShareDBError | null) => void;

  // ===============================
  // OT Type System
  // ===============================

  interface OTType {
    name: string;
    uri: string;
    create(snapshot?: any): any;
    apply(snapshot: any, op: Op[]): any;
    compose(op1: Op[], op2: Op[]): Op[];
    transform(op1: Op[], op2: Op[], priority: 'left' | 'right'): Op[];
    invert?(op: Op[]): Op[];
    normalize?(op: Op[]): Op[];
    transformPresence?(presence: any, op: Op[], isOwn: boolean): any;
    serialize?(snapshot: any): any;
    deserialize?(snapshot: any): any;
    diff?(oldSnapshot: any, newSnapshot: any): Op[];
  }

  interface OTTypeMap {
    [typeName: string]: OTType;
  }

  interface TypesModule {
    defaultType: OTType;
    map: OTTypeMap;
    register(type: OTType): void;
  }

  // ===============================
  // Backend Types
  // ===============================

  interface BackendOptions {
    db?: DB;
    pubsub?: PubSub;
    extraDbs?: { [name: string]: DB };
    milestoneDb?: MilestoneDB;
    suppressPublish?: boolean;
    maxSubmitRetries?: number;
    presence?: boolean;
    doNotForwardSendPresenceErrorsToClient?: boolean;
    doNotCommitNoOps?: boolean;
  }

  interface MiddlewareContext {
    agent?: Agent;
    collection: string;
    id: string;
    backend: Backend;
    snapshot?: Snapshot;
    op?: RawOp;
    query?: any;
    request?: any;
    [key: string]: any;
  }

  type Middleware = (context: MiddlewareContext, callback: Callback) => void;

  interface DB {
    commit(collection: string, id: string, op: RawOp, snapshot: Snapshot, callback: Callback): void;
    getSnapshot(collection: string, id: string, callback: Callback<Snapshot>): void;
    getSnapshotBulk(collection: string, ids: string[], callback: Callback<Snapshot[]>): void;
    getOps(collection: string, id: string, from: number, to: number, callback: Callback<RawOp[]>): void;
    getOpsToSnapshot(collection: string, id: string, from: number, snapshot: number, callback: Callback<RawOp[]>): void;
    query(collection: string, query: any, fields: any, options: any, callback: Callback): void;
    queryPoll(collection: string, query: any, options: any, callback: Callback): void;
    queryPollDoc(collection: string, id: string, query: any, options: any, callback: Callback): void;
    canPollDoc(collection: string, query: any): boolean;
    skipPoll(collection: string, id: string, query: any, options: any): boolean;
    close(callback?: Callback): void;
  }

  interface MemoryDB extends DB {
    docs: { [collection: string]: { [id: string]: Snapshot } };
    ops: { [collection: string]: { [id: string]: RawOp[] } };
    getSnapshot(collection: string, id: string, callback: Callback<Snapshot>): void;
    allowSnapshotType(type: string): boolean;
  }

  interface PubSub {
    publish(channels: string[], data: any, callback?: Callback): void;
    subscribe(channel: string, callback: (data: any) => void): void;
    unsubscribe(channel: string, callback: (data: any) => void): void;
    close(callback?: Callback): void;
  }

  interface MilestoneDB {
    getMilestoneSnapshot(collection: string, id: string, version: number, callback: Callback<Snapshot>): void;
    saveMilestoneSnapshot(collection: string, snapshot: Snapshot, callback: Callback): void;
    close(callback?: Callback): void;
  }

  interface Agent extends EventEmitter {
    backend: Backend;
    stream: any;
    connectTime: number;
    custom: any;

    close(): void;
    trigger(action: string, request: any, callback?: Callback): void;
  }

  interface Backend extends EventEmitter {
    readonly db: DB;
    readonly pubsub: PubSub;
    readonly extraDbs: { [name: string]: DB };
    readonly milestoneDb: MilestoneDB;
    readonly projections: { [collection: string]: any };

    use(action: string | string[], middleware: Middleware): void;
    connect(connection?: Connection, req?: any): Agent;
    listen(stream: any, req?: any): Agent;
    close(callback?: Callback): void;

    addProjection(name: string, collection: string, fields: any): void;
  }

  // ===============================
  // Client Types
  // ===============================

  interface ConnectionOptions {
    [key: string]: any;
  }

  interface Connection extends EventEmitter {
    readonly collections: { [collection: string]: { [id: string]: Doc } };
    readonly id: string;
    readonly state: 'connecting' | 'connected' | 'disconnected' | 'closed';
    readonly canSend: boolean;
    
    get(collection: string, id: string): Doc;
    createQuery(collection: string, query: any, options?: QueryOptions): Query;
    createSubscribeQuery(collection: string, query: any, options?: QueryOptions, callback?: Callback<Query>): Query;
    createFetchQuery(collection: string, query: any, options?: QueryOptions, callback?: Callback<Query>): Query;
    
    fetchSnapshot(collection: string, id: string, version?: number, callback?: Callback<Snapshot>): void;
    fetchSnapshotByTimestamp(collection: string, id: string, timestamp: number, callback?: Callback<Snapshot>): void;
    
    useDurableStore(durableStore: DurableStore): void;
    
    presence(channel: string): Presence;
    
    close(): void;
    
    // Events: 'connected', 'disconnected', 'closed', 'error', 'state'
  }

  interface DocOptions {
    [key: string]: any;
  }

  interface Doc extends EventEmitter {
    readonly collection: string;
    readonly id: string;
    readonly data: any;
    readonly version: number;
    readonly type: any;
    readonly subscribed: boolean;
    readonly hasWritePending: boolean;
    readonly inflightCreate: RawOp | null;
    readonly inflightDel: RawOp | null;
    readonly inflightOp: RawOp | null;
    readonly pendingOps: RawOp[];

    create(data: any, type?: string | any, options?: any, callback?: OpCallback): this;
    create(data: any, type?: string | any, callback?: OpCallback): this;
    create(data: any, callback?: OpCallback): this;

    submitOp(op: Op[], options?: any, callback?: OpCallback): this;
    submitOp(op: Op[], callback?: OpCallback): this;
    submitOp(op: Op, options?: any, callback?: OpCallback): this;
    submitOp(op: Op, callback?: OpCallback): this;

    del(options?: any, callback?: OpCallback): this;
    del(callback?: OpCallback): this;

    fetch(callback?: Callback): this;
    subscribe(callback?: Callback): this;
    unsubscribe(callback?: Callback): this;

    whenNothingPending(callback: Callback): void;

    // Events: 'load', 'create', 'before op', 'op', 'del', 'error', 'nothing pending'
  }

  interface QueryOptions {
    results?: any[];
    [key: string]: any;
  }

  interface Query extends EventEmitter {
    readonly collection: string;
    readonly query: any;
    readonly options: QueryOptions;
    readonly results: any[] | null;
    readonly ready: boolean;
    readonly subscribed: boolean;

    subscribe(callback?: Callback): this;
    unsubscribe(callback?: Callback): this;
    fetch(callback?: Callback): this;
    destroy(): void;

    // Events: 'ready', 'error', 'changed', 'insert', 'move', 'remove'
  }

  // ===============================
  // DurableStore Types  
  // ===============================

  interface DurableStoreOptions {
    maxBatchSize?: number;
    extVersionDecoder?: (data: any) => string | number;
    opErrorCallback?: (error: ShareDBError) => void;
    debug?: boolean;
  }

  interface DurableStore extends EventEmitter {
    readonly storage: Storage;
    readonly maxBatchSize: number;
    readonly debug: boolean;

    initialize(callback: Callback): void;
    persistDocuments(docs: Doc[], callback: Callback): void;
    retrieveDocuments(callback: Callback<any[]>): void;
    clearDocuments(callback: Callback): void;
    
    // Events: 'load', 'error'
  }

  // ===============================
  // Storage Types
  // ===============================

  interface StorageRecord {
    id: string;
    payload: any;
  }

  interface StorageRecords {
    docs?: StorageRecord | StorageRecord[];
    meta?: StorageRecord | StorageRecord[];
  }

  interface Storage {
    initialize(callback: Callback): void;
    readRecord(storeName: string, id: string, callback: Callback<any>): void;
    readAllRecords(storeName: string, callback: Callback<StorageRecord[]>): void;
    writeRecords(records: StorageRecords, callback: Callback): void;
    deleteRecord(storeName: string, id: string, callback: Callback): void;
    clearStore(storeName: string, callback: Callback): void;
    clearAll(callback: Callback): void;
    close?(callback: Callback): void;
    isReady?(): boolean;
  }

  interface InMemoryStorageOptions {
    debug?: boolean;
  }

  interface InMemoryStorage extends Storage {
    readonly ready: boolean;
    readonly stores: { [storeName: string]: { [id: string]: any } };
  }

  interface IndexedDbStorageOptions {
    namespace?: string;
    useEncryption?: boolean;
    encryptionCallback?: (text: string) => string;
    decryptionCallback?: (encrypted: string) => string;
    debug?: boolean;
    maxBatchSize?: number;
  }

  interface IndexedDbStorage extends Storage {
    readonly namespace: string;
    readonly dbName: string;
    readonly useEncryption: boolean;
    readonly ready: boolean;
    readonly db: IDBDatabase;

    deleteDatabase(): void;
  }

  // ===============================
  // SQLite Storage Types
  // ===============================

  interface SqliteStorageOptions {
    adapter: SqliteAdapter;
    schemaStrategy?: SchemaStrategy;
    debug?: boolean;
  }

  interface SqliteStorage extends Storage {
    readonly adapter: SqliteAdapter;
    readonly schemaStrategy: SchemaStrategy;
    readonly ready: boolean;

    updateInventory(collection: string, docId: string, version: number, operation: string, callback: Callback): void;
    readInventory(callback: Callback): void;
    deleteDatabase(callback: Callback): void;
  }

  interface SqliteAdapter {
    readonly isReady: boolean;

    openDatabase(callback: Callback): void;
    closeDatabase(callback: Callback): void;
    run(sql: string, params: any[], callback: Callback): void;
    get(sql: string, params: any[], callback: Callback): void;
    all(sql: string, params: any[], callback: Callback): void;
    getType(): string;
  }

  interface ExpoSqliteAdapterOptions {
    database: any; // Expo SQLite database instance
    debug?: boolean;
  }

  interface ExpoSqliteAdapter extends SqliteAdapter {
    readonly database: any;
  }

  interface NodeSqliteAdapterOptions {
    debug?: boolean;
  }

  interface NodeSqliteAdapter extends SqliteAdapter {}

  // ===============================
  // Schema Strategy Types
  // ===============================

  interface CollectionConfig {
    indexes: string[];
    encryptedFields: string[];
  }

  interface SchemaStrategyOptions {
    useEncryption?: boolean;
    encryptionCallback?: (text: string) => string;
    decryptionCallback?: (encrypted: string) => string;
    debug?: boolean;
  }

  interface SchemaStrategy {
    initializeSchema(db: any, callback: Callback): void;
    validateSchema(db: any, callback: Callback): void;
    writeRecords(db: any, records: StorageRecords, callback: Callback): void;
    readRecord(db: any, type: string, id: string, collection?: string, callback?: Callback): void;
    readAllRecords(db: any, type: string, collection?: string, callback?: Callback): void;
    deleteRecord(db: any, type: string, id: string, collection?: string, callback?: Callback): void;
    clearStore(db: any, storeName: string, callback: Callback): void;
    clearAll(db: any, callback: Callback): void;
    updateInventoryItem(db: any, collection: string, docId: string, version: number, operation: string, callback: Callback): void;
    readInventory(db: any, callback: Callback): void;
    initializeInventory(db: any, callback: Callback): void;
    getInventoryType(): string;
  }

  interface DefaultSchemaStrategyOptions extends SchemaStrategyOptions {}

  interface DefaultSchemaStrategy extends SchemaStrategy {}

  interface CollectionPerTableStrategyOptions extends SchemaStrategyOptions {
    collectionConfig: { [collection: string]: CollectionConfig };
  }

  interface CollectionPerTableStrategy extends SchemaStrategy {
    readonly collectionConfig: { [collection: string]: CollectionConfig };
    
    getTableName(collection: string): string;
    ensureCollectionTable(db: any, collection: string, callback: Callback): void;
  }

  // ===============================
  // Static Constructors
  // ===============================

  interface BackendStatic {
    new (options?: BackendOptions): Backend;
    (options?: BackendOptions): Backend;
  }

  interface ConnectionStatic {
    new (socket: any, options?: ConnectionOptions): Connection;
  }

  interface DocStatic {
    new (connection: Connection, collection: string, id: string, options?: DocOptions): Doc;
  }

  interface QueryStatic {
    new (connection: Connection, collection: string, query: any, options?: QueryOptions): Query;
  }

  interface DurableStoreStatic {
    new (storage: Storage, options?: DurableStoreOptions): DurableStore;
  }

  interface InMemoryStorageStatic {
    new (options?: InMemoryStorageOptions): InMemoryStorage;
  }

  interface IndexedDbStorageStatic {
    new (options?: IndexedDbStorageOptions): IndexedDbStorage;
  }

  interface SqliteStorageStatic {
    new (options: SqliteStorageOptions): SqliteStorage;
  }

  interface ExpoSqliteAdapterStatic {
    new (options: ExpoSqliteAdapterOptions): ExpoSqliteAdapter;
  }

  interface NodeSqliteAdapterStatic {
    new (options?: NodeSqliteAdapterOptions): NodeSqliteAdapter;
  }

  interface DefaultSchemaStrategyStatic {
    new (options?: DefaultSchemaStrategyOptions): DefaultSchemaStrategy;
  }

  interface CollectionPerTableStrategyStatic {
    new (options: CollectionPerTableStrategyOptions): CollectionPerTableStrategy;
  }
}

// ===============================
// Main ShareDB Module Declaration
// ===============================

declare class ShareDB extends ShareDB.Backend {
  constructor(options?: ShareDB.BackendOptions);

  static Agent: any;
  static Backend: ShareDB.BackendStatic;
  static DB: any;
  static Error: any;
  static logger: any;
  static MemoryDB: any;
  static MemoryMilestoneDB: any;
  static MemoryPubSub: any;
  static MESSAGE_ACTIONS: any;
  static MilestoneDB: any;
  static ot: any;
  static projections: any;
  static PubSub: any;
  static QueryEmitter: any;
  static SubmitRequest: any;
  static types: TypesModule;
}

declare namespace ShareDB {
  export const Connection: ConnectionStatic;
  export const Doc: DocStatic; 
  export const Query: QueryStatic;
}

export = ShareDB;