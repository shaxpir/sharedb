// Example TypeScript usage of ShareDB with DurableStore
// This file demonstrates proper TypeScript usage patterns

import ShareDB from '../index';
import { 
  DurableStore,
  SqliteStorage,
  ExpoSqliteAdapter,
  CollectionPerTableStrategy,
  Types
} from '../lib/client/storage/index';

// ===============================
// Server-side Example
// ===============================

// Create a ShareDB backend with proper typing
const backend = new ShareDB({
  db: new ShareDB.MemoryDB(),
  pubsub: new ShareDB.MemoryPubSub()
});

// Add middleware with proper types
backend.use('submit', (context: ShareDB.MiddlewareContext, callback: ShareDB.Callback) => {
  console.log(`Document ${context.id} in collection ${context.collection} submitted`);
  callback(null);
});

// ===============================
// Client-side Example with DurableStore
// ===============================

async function setupClientWithStorage(): Promise<ShareDB.Connection> {
  // Define schema configuration with proper typing
  const collectionConfig: { [collection: string]: Types.CollectionConfig } = {
    users: {
      indexes: ['email', 'username', 'preferences.theme'],
      encryptedFields: ['email', 'personalInfo.ssn']
    },
    posts: {
      indexes: ['authorId', 'createdAt', 'engagement.likes'],
      encryptedFields: ['content']
    }
  };

  // Create SQLite adapter (example with Expo)
  const adapter: Types.SqliteAdapter = new ExpoSqliteAdapter({
    database: null, // Your Expo SQLite database instance
    debug: true
  });

  // Create schema strategy
  const schemaStrategy = new CollectionPerTableStrategy({
    collectionConfig,
    useEncryption: true,
    encryptionCallback: (text: string): string => {
      // Your encryption implementation
      return Buffer.from(text).toString('base64');
    },
    decryptionCallback: (encrypted: string): string => {
      // Your decryption implementation
      return Buffer.from(encrypted, 'base64').toString();
    }
  });

  // Create storage with proper typing
  const storage: Types.Storage = new SqliteStorage({
    adapter,
    schemaStrategy,
    debug: true
  });

  // Initialize storage
  await new Promise<void>((resolve, reject) => {
    storage.initialize((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  // Create DurableStore
  const durableStore: Types.DurableStore = new DurableStore(storage, {
    maxBatchSize: 50,
    debug: true,
    opErrorCallback: (error: Error) => {
      console.error('DurableStore operation error:', error);
    }
  });

  // Create connection with DurableStore
  const connection = new ShareDB.Connection(null /* your websocket */);
  connection.useDurableStore(durableStore);

  return connection;
}

// ===============================
// Document Operations with Types
// ===============================

interface UserProfile {
  userId: string;
  username: string;
  email: string;
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
  personalInfo: {
    realName: string;
    ssn: string; // This will be encrypted
  };
}

async function demonstrateDocumentOperations(connection: ShareDB.Connection): Promise<void> {
  // Get a typed document
  const profileDoc: ShareDB.Doc = connection.get('users', 'user123');

  // Subscribe to the document
  await new Promise<void>((resolve, reject) => {
    profileDoc.subscribe((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  // Create document with typed data
  if (!profileDoc.data) {
    const initialData: UserProfile = {
      userId: 'user123',
      username: 'johndoe',
      email: 'john@example.com', // Will be encrypted
      preferences: {
        theme: 'light',
        notifications: true
      },
      personalInfo: {
        realName: 'John Doe',
        ssn: '123-45-6789' // Will be encrypted
      }
    };

    await new Promise<void>((resolve, reject) => {
      profileDoc.create(initialData, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  // Update document with operational transforms
  const updateOps: ShareDB.Op[] = [
    {
      p: ['preferences', 'theme'],
      od: 'light',
      oi: 'dark'
    },
    {
      p: ['preferences', 'notifications'],
      od: true,
      oi: false
    }
  ];

  await new Promise<void>((resolve, reject) => {
    profileDoc.submitOp(updateOps, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  console.log('Profile updated:', profileDoc.data);
}

// ===============================
// Query Operations with Types
// ===============================

async function demonstrateQueries(connection: ShareDB.Connection): Promise<void> {
  // Create a query with proper typing
  const postsQuery: ShareDB.Query = connection.createQuery('posts', {
    authorId: 'user123',
    'engagement.likes': { $gte: 10 }
  });

  // Subscribe to query results
  await new Promise<void>((resolve, reject) => {
    postsQuery.subscribe((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  // Handle query events with proper types
  postsQuery.on('ready', () => {
    console.log('Query ready, results:', postsQuery.results);
  });

  postsQuery.on('changed', (results: any[]) => {
    console.log('Query results changed:', results);
  });

  postsQuery.on('insert', (docs: any[], index: number) => {
    console.log(`${docs.length} documents inserted at index ${index}`);
  });

  postsQuery.on('remove', (docs: any[], index: number) => {
    console.log(`${docs.length} documents removed from index ${index}`);
  });
}

// ===============================
// Error Handling
// ===============================

function handleShareDBError(error: ShareDB.Error): void {
  console.error(`ShareDB Error ${error.code}: ${error.message}`);
  
  // Handle specific error codes
  switch (error.code) {
    case 4001: // ERR_DOC_ALREADY_CREATED
      console.log('Document already exists');
      break;
    case 4002: // ERR_DOC_DOES_NOT_EXIST
      console.log('Document does not exist');
      break;
    case 4003: // ERR_DOC_TYPE_NOT_RECOGNIZED
      console.log('Document type not recognized');
      break;
    default:
      console.log('Unknown error');
  }
}

// ===============================
// Usage Example
// ===============================

async function main(): Promise<void> {
  try {
    const connection = await setupClientWithStorage();
    await demonstrateDocumentOperations(connection);
    await demonstrateQueries(connection);
    
    console.log('ShareDB TypeScript example completed successfully!');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      handleShareDBError(error as ShareDB.Error);
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

// Export for use in other files
export {
  setupClientWithStorage,
  demonstrateDocumentOperations,
  demonstrateQueries,
  handleShareDBError,
  UserProfile
};