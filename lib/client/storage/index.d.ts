// Type definitions for ShareDB Storage Systems
// Project: https://github.com/share/sharedb
// Definitions by: Claude Code <https://claude.ai/code>

import { EventEmitter } from 'events';

declare namespace ShareDBStorage {
  // ===============================
  // Core Storage Types
  // ===============================

  type Callback<T = any> = (error: Error | null, result?: T) => void;

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

  // ===============================
  // DurableStore
  // ===============================

  interface DurableStoreOptions {
    maxBatchSize?: number;
    extVersionDecoder?: (data: any) => string | number;
    opErrorCallback?: (error: Error) => void;
    debug?: boolean;
  }

  interface DurableStore extends EventEmitter {
    readonly storage: Storage;
    readonly maxBatchSize: number;
    readonly debug: boolean;

    initialize(callback: Callback): void;
    persistDocuments(docs: any[], callback: Callback): void;
    retrieveDocuments(callback: Callback<any[]>): void;
    clearDocuments(callback: Callback): void;
    
    // Events: 'load', 'error'
  }

  interface DurableStoreStatic {
    new (storage: Storage, options?: DurableStoreOptions): DurableStore;
  }

  // ===============================
  // In-Memory Storage
  // ===============================

  interface InMemoryStorageOptions {
    debug?: boolean;
  }

  interface InMemoryStorage extends Storage {
    readonly ready: boolean;
    readonly stores: { [storeName: string]: { [id: string]: any } };
  }

  interface InMemoryStorageStatic {
    new (options?: InMemoryStorageOptions): InMemoryStorage;
  }

  // ===============================
  // IndexedDB Storage
  // ===============================

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

  interface IndexedDbStorageStatic {
    new (options: IndexedDbStorageOptions): IndexedDbStorage;
  }

  // ===============================
  // SQLite Storage System
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

  interface SqliteStorageStatic {
    new (options: SqliteStorageOptions): SqliteStorage;
  }

  // ===============================
  // SQLite Adapters
  // ===============================

  interface SqliteAdapter {
    readonly isReady: boolean;

    openDatabase(callback: Callback): void;
    closeDatabase(callback: Callback): void;
    run(sql: string, params: any[], callback: Callback): void;
    get(sql: string, params: any[], callback: Callback): void;
    all(sql: string, params: any[], callback: Callback): void;
    getType(): string;
  }

  interface BaseSqliteAdapter extends SqliteAdapter {}

  interface BaseSqliteAdapterStatic {
    new (options?: any): BaseSqliteAdapter;
  }

  interface ExpoSqliteAdapterOptions {
    database: any; // Expo SQLite database instance
    debug?: boolean;
  }

  interface ExpoSqliteAdapter extends SqliteAdapter {
    readonly database: any;
  }

  interface ExpoSqliteAdapterStatic {
    new (options: ExpoSqliteAdapterOptions): ExpoSqliteAdapter;
  }

  interface NodeSqliteAdapterOptions {
    debug?: boolean;
  }

  interface NodeSqliteAdapter extends SqliteAdapter {
    readonly db: any; // better-sqlite3 or sqlite3 database instance
  }

  interface NodeSqliteAdapterStatic {
    new (options?: NodeSqliteAdapterOptions): NodeSqliteAdapter;
  }

  // ===============================
  // Schema Strategies
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

  interface BaseSchemaStrategy extends SchemaStrategy {}

  interface BaseSchemaStrategyStatic {
    new (options?: SchemaStrategyOptions): BaseSchemaStrategy;
  }

  interface DefaultSchemaStrategyOptions extends SchemaStrategyOptions {}

  interface DefaultSchemaStrategy extends SchemaStrategy {}

  interface DefaultSchemaStrategyStatic {
    new (options?: DefaultSchemaStrategyOptions): DefaultSchemaStrategy;
  }

  interface CollectionPerTableStrategyOptions extends SchemaStrategyOptions {
    collectionConfig: { [collection: string]: CollectionConfig };
  }

  interface CollectionPerTableStrategy extends SchemaStrategy {
    readonly collectionConfig: { [collection: string]: CollectionConfig };
    
    getTableName(collection: string): string;
    ensureCollectionTable(db: any, collection: string, callback: Callback): void;
  }

  interface CollectionPerTableStrategyStatic {
    new (options: CollectionPerTableStrategyOptions): CollectionPerTableStrategy;
  }

  // ===============================
  // Legacy Export (ExpoSqliteStorage)
  // ===============================

  interface ExpoSqliteStorageOptions {
    sqliteDatabase: any;
    useEncryption?: boolean;
    encryptionCallback?: (text: string) => string;
    decryptionCallback?: (encrypted: string) => string;
    debug?: boolean;
  }

  interface ExpoSqliteStorage extends Storage {
    readonly sqliteDatabase: any;
    readonly useEncryption: boolean;
    readonly ready: boolean;
  }

  interface ExpoSqliteStorageStatic {
    new (options: ExpoSqliteStorageOptions): ExpoSqliteStorage;
  }
}

// ===============================
// Named Exports
// ===============================

export const DurableStore: ShareDBStorage.DurableStoreStatic;
export const InMemoryStorage: ShareDBStorage.InMemoryStorageStatic;
export const IndexedDbStorage: ShareDBStorage.IndexedDbStorageStatic;
export const SqliteStorage: ShareDBStorage.SqliteStorageStatic;
export const ExpoSqliteStorage: ShareDBStorage.ExpoSqliteStorageStatic;

// Adapters
export const BaseSqliteAdapter: ShareDBStorage.BaseSqliteAdapterStatic;
export const ExpoSqliteAdapter: ShareDBStorage.ExpoSqliteAdapterStatic;
export const NodeSqliteAdapter: ShareDBStorage.NodeSqliteAdapterStatic;

// Schema Strategies
export const BaseSchemaStrategy: ShareDBStorage.BaseSchemaStrategyStatic;
export const DefaultSchemaStrategy: ShareDBStorage.DefaultSchemaStrategyStatic;
export const CollectionPerTableStrategy: ShareDBStorage.CollectionPerTableStrategyStatic;

// Type exports
export namespace Types {
  export type Storage = ShareDBStorage.Storage;
  export type StorageRecord = ShareDBStorage.StorageRecord;
  export type StorageRecords = ShareDBStorage.StorageRecords;
  export type DurableStore = ShareDBStorage.DurableStore;
  export type SqliteAdapter = ShareDBStorage.SqliteAdapter;
  export type SchemaStrategy = ShareDBStorage.SchemaStrategy;
  export type CollectionConfig = ShareDBStorage.CollectionConfig;
  export type Callback<T = any> = ShareDBStorage.Callback<T>;
}