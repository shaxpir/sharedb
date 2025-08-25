# ShareDB TypeScript Definitions

This package includes comprehensive TypeScript definitions for ShareDB, covering both server-side and client-side APIs, including the new DurableStore and pluggable storage systems.

## Installation and Setup

```bash
npm install @shaxpir/sharedb
```

The TypeScript definitions are automatically included when you import the package. No additional `@types/` package is needed.

## Basic Usage

### Server-side (Backend)

```typescript
import ShareDB from '@shaxpir/sharedb';

// Create backend with typed options
const backend = new ShareDB({
  db: new ShareDB.MemoryDB(),
  pubsub: new ShareDB.MemoryPubSub(),
  presence: true
});

// Add middleware with proper typing
backend.use('submit', (context: ShareDB.MiddlewareContext, callback: ShareDB.Callback) => {
  console.log(`Document ${context.id} submitted`);
  callback(null);
});
```

### Client-side (Connection & Documents)

```typescript
import { Connection, Doc, Query } from '@shaxpir/sharedb/lib/client';

// Create connection
const connection = new Connection(websocket);

// Work with documents
const doc: Doc = connection.get('posts', 'post123');
doc.subscribe((error) => {
  if (error) throw error;
  console.log('Document data:', doc.data);
});

// Create queries
const query: Query = connection.createQuery('posts', { published: true });
```

## DurableStore with TypeScript

The DurableStore system is fully typed, including all storage implementations and schema strategies.

### Basic DurableStore Setup

```typescript
import { 
  DurableStore,
  InMemoryStorage,
  Types
} from '@shaxpir/sharedb/lib/client/storage';

// Create storage
const storage: Types.Storage = new InMemoryStorage({ debug: true });

// Create DurableStore
const durableStore: Types.DurableStore = new DurableStore(storage, {
  maxBatchSize: 50,
  debug: true
});

// Use with connection
connection.useDurableStore(durableStore);
```

### SQLite Storage with Schema Strategies

```typescript
import { 
  SqliteStorage,
  ExpoSqliteAdapter,
  CollectionPerTableStrategy,
  Types
} from '@shaxpir/sharedb/lib/client/storage';

// Define collection configuration
const collectionConfig: { [collection: string]: Types.CollectionConfig } = {
  users: {
    indexes: ['email', 'username', 'preferences.notifications.email'],
    encryptedFields: ['email', 'personalInfo.ssn']
  },
  posts: {
    indexes: ['authorId', 'createdAt', 'engagement.likes'],
    encryptedFields: ['content', 'privateMetadata.personalNotes']
  }
};

// Create adapter
const adapter: Types.SqliteAdapter = new ExpoSqliteAdapter({
  database: yourExpoSqliteDatabase,
  debug: true
});

// Create schema strategy with encryption
const schemaStrategy = new CollectionPerTableStrategy({
  collectionConfig,
  useEncryption: true,
  encryptionCallback: (text: string): string => {
    return yourEncryptionFunction(text);
  },
  decryptionCallback: (encrypted: string): string => {
    return yourDecryptionFunction(encrypted);
  }
});

// Create storage
const storage: Types.Storage = new SqliteStorage({
  adapter,
  schemaStrategy,
  debug: true
});
```

### IndexedDB Storage

```typescript
import { IndexedDbStorage } from '@shaxpir/sharedb/lib/client/storage';

const storage = new IndexedDbStorage({
  namespace: 'my-app',
  useEncryption: true,
  encryptionCallback: (text: string) => encrypt(text),
  decryptionCallback: (encrypted: string) => decrypt(encrypted),
  maxBatchSize: 100
});
```

## Type-Safe Document Operations

### Defining Document Interfaces

```typescript
interface UserProfile {
  userId: string;
  username: string;
  email: string;
  preferences: {
    theme: 'light' | 'dark';
    notifications: {
      email: boolean;
      push: boolean;
    };
  };
  personalInfo: {
    realName: string;
    address: {
      street: string;
      city: string;
      zipCode: string;
    };
  };
}

interface BlogPost {
  authorId: string;
  title: string;
  content: string;
  createdAt: string;
  tags: string[];
  engagement: {
    likes: number;
    shares: number;
    comments: number;
  };
  metadata: {
    category: string;
    contentType: 'text' | 'markdown' | 'html';
  };
}
```

### Working with Different OT Types

ShareDB supports pluggable OT (Operational Transform) types. The `Op` type is intentionally generic (`any`) to accommodate all OT implementations:

```typescript
// JSON0 operations (default)
const json0Ops: ShareDB.Json0Op[] = [
  { p: ['name'], od: 'John', oi: 'Jane' },
  { p: ['age'], na: 1 },
  { p: ['tags'], li: 'new-tag' }
];

// Rich Text operations  
const richTextOps: ShareDB.RichTextOp[] = [
  { retain: 5 },
  { insert: 'Hello' },
  { delete: 3 },
  { insert: 'World', attributes: { bold: true } }
];

// Text operations
const textOps: ShareDB.TextOp[] = [
  { retain: 10 },
  { insert: 'new text' },
  { delete: 5 }
];

// Using operations (all are compatible with ShareDB.Op)
doc.submitOp(json0Ops);      // Works
doc.submitOp(richTextOps);   // Works  
doc.submitOp(textOps);       // Works
```

### Registering Custom OT Types

```typescript
// Register a custom OT type
const customType: ShareDB.OTType = {
  name: 'my-custom-type',
  uri: 'http://example.com/my-custom-type',
  
  create: (initialData?) => initialData || {},
  
  apply: (snapshot, ops) => {
    // Apply operations to snapshot
    return newSnapshot;
  },
  
  compose: (op1, op2) => {
    // Compose two operations
    return composedOp;
  },
  
  transform: (op1, op2, priority) => {
    // Transform op1 against op2
    return transformedOp;
  }
};

// Register with ShareDB
ShareDB.types.register(customType);

// Use in document creation
doc.create(initialData, 'my-custom-type');
```

### Type-Safe Document Operations

```typescript
// Create document with typed data
const initialProfile: UserProfile = {
  userId: 'user123',
  username: 'johndoe',
  email: 'john@example.com',
  preferences: {
    theme: 'light',
    notifications: {
      email: true,
      push: false
    }
  },
  personalInfo: {
    realName: 'John Doe',
    address: {
      street: '123 Main St',
      city: 'Anytown',
      zipCode: '12345'
    }
  }
};

profileDoc.create(initialProfile, (error) => {
  if (error) throw error;
});

// Type-safe operational transforms
const updateOps: ShareDB.Op[] = [
  {
    p: ['preferences', 'theme'],
    od: 'light',
    oi: 'dark'
  },
  {
    p: ['preferences', 'notifications', 'push'],
    od: false,
    oi: true
  }
];

profileDoc.submitOp(updateOps);
```

## Advanced Types

### Custom Storage Implementation

```typescript
import { Types } from '@shaxpir/sharedb/lib/client/storage';

class MyCustomStorage implements Types.Storage {
  private ready = false;

  async initialize(callback: Types.Callback): Promise<void> {
    // Your initialization logic
    this.ready = true;
    callback(null);
  }

  readRecord(storeName: string, id: string, callback: Types.Callback<any>): void {
    // Your implementation
  }

  writeRecords(records: Types.StorageRecords, callback: Types.Callback): void {
    // Your implementation
  }

  // ... implement other required methods
}
```

### Custom Schema Strategy

```typescript
import { Types } from '@shaxpir/sharedb/lib/client/storage';

class MySchemaStrategy implements Types.SchemaStrategy {
  initializeSchema(db: any, callback: Types.Callback): void {
    // Your schema initialization
  }

  getInventoryType(): string {
    return 'custom';
  }

  // ... implement other required methods
}
```

## Error Handling

```typescript
function handleShareDBError(error: ShareDB.Error): void {
  console.error(`ShareDB Error ${error.code}: ${error.message}`);
  
  // ShareDB error codes are available as constants
  switch (error.code) {
    case 4001: // ERR_DOC_ALREADY_CREATED
      // Handle document already exists
      break;
    case 4002: // ERR_DOC_DOES_NOT_EXIST  
      // Handle document not found
      break;
    // ... handle other error codes
  }
}
```

## Event Handling

All ShareDB classes extend EventEmitter and provide proper typing for events:

```typescript
// Document events
doc.on('load', () => console.log('Document loaded'));
doc.on('op', (op: ShareDB.Op[], source: boolean) => {
  console.log('Operation applied:', op);
});
doc.on('create', (source: boolean) => console.log('Document created'));
doc.on('del', (data: any, source: boolean) => console.log('Document deleted'));

// Query events  
query.on('ready', () => console.log('Query ready'));
query.on('changed', (results: any[]) => console.log('Results changed'));
query.on('insert', (docs: any[], index: number) => console.log('Docs inserted'));
query.on('remove', (docs: any[], index: number) => console.log('Docs removed'));

// Connection events
connection.on('connected', () => console.log('Connected'));
connection.on('disconnected', () => console.log('Disconnected'));
connection.on('error', (error: ShareDB.Error) => handleShareDBError(error));
```

## Complete Example

See the complete TypeScript usage example in `/examples/typescript-usage.ts` for a comprehensive demonstration of all features including:

- Server setup with middleware
- Client setup with DurableStore 
- SQLite storage with encryption
- Type-safe document operations
- Query handling
- Error management

## Type Exports

All types are available for import:

```typescript
import { Types } from '@shaxpir/sharedb/lib/client/storage';

// Use any type from the Types namespace
type MyStorage = Types.Storage;
type MyCallback = Types.Callback<string>;
type MyCollectionConfig = Types.CollectionConfig;
```

This provides full IntelliSense support and compile-time type checking for all ShareDB operations.