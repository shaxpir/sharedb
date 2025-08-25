// Type definitions for ShareDB Storage Systems
// Project: https://github.com/share/sharedb
// Definitions by: Claude Code <https://claude.ai/code>

import { EventEmitter } from 'events';

// Import main ShareDB types for OT operations
import { ShareDBError, Op, Json0Op, RichTextOp, TextOp, OTType } from '../../index';

declare namespace ShareDBStorage {
  // ===============================
  // Core Storage Types
  // ===============================

  type Callback<T = any> = (error: ShareDBError | null, result?: T) => void;

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
    readRecordsBulk?(storeName: string, ids: string[], callback: Callback<StorageRecord[]>): void;
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
    opErrorCallback?: (error: ShareDBError) => void;
    debug?: boolean;
  }

  interface DurableStore extends EventEmitter {
    readonly storage: Storage;
    readonly maxBatchSize: number;
    readonly debug: boolean;

    initialize(callback: Callback): void;
    persistDocuments(docs: any[], callback: Callback): void;
    retrieveDocuments(callback: Callback<any[]>): void;
    retrieveDocumentsBulk(collection: string, ids: string[], callback: Callback<any[]>): void;
    clearDocuments(callback: Callback): void;
    
    // Batch writing control
    putDocsBulk(docs: any[], callback?: Callback): void;
    flush(callback?: Callback): void;
    getWriteQueueSize(): number;
    setAutoBatchEnabled(enabled: boolean): void;
    isAutoBatchEnabled(): boolean;
    
    // Events: 'load', 'error', 'before persist', 'persist', 'no persist pending'
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


}

// ===============================
// Named Exports
// ===============================

export const DurableStore: ShareDBStorage.DurableStoreStatic;
export const InMemoryStorage: ShareDBStorage.InMemoryStorageStatic;
export const IndexedDbStorage: ShareDBStorage.IndexedDbStorageStatic;

// Type exports
export namespace Types {
  export type Storage = ShareDBStorage.Storage;
  export type StorageRecord = ShareDBStorage.StorageRecord;
  export type StorageRecords = ShareDBStorage.StorageRecords;
  export type DurableStore = ShareDBStorage.DurableStore;
  export type Callback<T = any> = ShareDBStorage.Callback<T>;
}