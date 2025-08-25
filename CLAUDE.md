# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Testing
- `npm test` - Run the full test suite
- `npm run test-cover` - Run tests with code coverage
- `npm run build:test-browser` - Build browser tests (required before running browser tests)
- `npm run watch:test-browser` - Watch and rebuild browser tests during development

### Documentation
- `npm run docs:start` - Start local documentation server at http://localhost:4000

## Architecture Overview

ShareDB is a real-time collaborative editing framework with Operational Transform (OT) support. This is the Shaxpir fork which adds DurableStore for offline persistence.

### Core Components

1. **Backend (`lib/backend.js`)** - Server orchestrator that:
   - Manages client connections and document operations
   - Integrates pluggable database, pub/sub, and milestone DB adapters
   - Processes operations through middleware pipeline
   - Handles projections for field filtering

2. **Client Connection (`lib/client/connection.js`)** - Client-side connection that:
   - Manages WebSocket communication with backend
   - Handles document and query subscriptions
   - Integrates with DurableStore for offline persistence (Shaxpir fork feature)
   - Manages presence subscriptions

3. **Document (`lib/client/doc.js`)** - Client document representation that:
   - Submits operations and handles conflicts via OT
   - Maintains local and remote state
   - Emits events for state changes
   - Integrates with DurableStore for offline operation queuing

4. **Operational Transform (`lib/ot.js`)** - Core OT engine that:
   - Transforms concurrent operations to maintain consistency
   - Handles create, delete, and edit operations
   - Manages version control and conflict resolution

### Adapter Pattern

ShareDB uses adapters for pluggability:
- **Database** (`lib/db/`) - Document storage (Memory or custom implementation)
- **PubSub** (`lib/pubsub/`) - Inter-server communication (Memory or Redis)
- **MilestoneDB** (`lib/milestone-db/`) - Snapshot storage for performance

### Shaxpir Fork Features

**DurableStore** (`lib/client/durable-store.js`):
- Pluggable storage architecture supporting multiple persistence layers
- Built-in IndexedDB storage for browser environments
- Queues operations when offline
- Supports encryption callbacks
- Automatically syncs on reconnection
- Enabled via `connection.useDurableStore({storage: storageAdapter})`

**ProxyConnection & Multi-tab Safety** (`lib/client/proxy-connection.js`):
- MessageBroker system for coordinating multiple browser tabs
- Prevents DurableStore conflicts in multi-tab environments
- Enables safe shared storage across tabs with coordinated sync
- SharedWorker-based inter-tab communication

**Available Storage Adapters**:
- **Built-in IndexedDB Storage** (`lib/client/storage/indexed-db-storage.js`) - Default browser storage
- **[@shaxpir/sharedb-storage-expo-sqlite](https://github.com/shaxpir/sharedb-storage-expo-sqlite)** - React Native SQLite storage with:
  - Dual-database architecture support
  - Connection pooling capabilities  
  - Cross-database query support
  - Zero bundling conflicts with browser/Node.js environments

**Custom Storage Adapters**:
Third parties can implement custom storage adapters by implementing the DurableStore storage interface, enabling persistence to any storage backend (filesystem, cloud storage, etc.).

### Key Development Notes

- **ES3 Compatibility**: Core library uses ES3 syntax (no arrow functions, const/let, etc.)
- **Event-Driven**: Heavy use of EventEmitter pattern throughout
- **Middleware**: Operations can be intercepted via middleware hooks
- **Testing**: Comprehensive test suite - always run tests before committing
