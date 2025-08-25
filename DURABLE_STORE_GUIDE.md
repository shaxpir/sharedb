# DurableStore Implementation Guide for React Native

This guide walks you through implementing ShareDB's DurableStore system in a React Native application using SQLite storage. We'll build a complete social media app data layer with user profiles, friend lists, and news feeds, demonstrating how to leverage the pluggable storage architecture with schema strategies, encryption, and automatic SQLite indexing.

## Overview of the Architecture

The DurableStore system provides offline-first data persistence for ShareDB documents through a layered architecture. At its core, you inject a storage implementation into the DurableStore, which handles document synchronization, operation queuing, and conflict resolution. The storage layer itself uses schema strategies to organize data in the underlying database, whether that's a single JSON table or separate tables per collection with custom indexing.

For React Native applications, we use the ExpoSqliteStorage implementation, which wraps Expo's SQLite interface and provides the same API as browser-based IndexedDbStorage. This allows your app to work offline and sync changes when connectivity returns.

## Setting Up Dependencies

First, ensure you have the required dependencies in your React Native project:

```bash
npm install expo-sqlite @shaxpir/sharedb @shaxpir/sharedb-storage-expo-sqlite
```

```javascript
import { ExpoSqliteStorage } from '@shaxpir/sharedb-storage-expo-sqlite';
```

**Note**: ExpoSqliteStorage is only available in the dedicated `@shaxpir/sharedb-storage-expo-sqlite` package. It was moved out of the main ShareDB package to avoid bundling conflicts and provide better React Native architecture.

## Defining Your Data Schema

Let's model a social media application with four main document types: users, profiles, friendships, and posts. Each will be stored as JSON documents in ShareDB, but we'll use schema strategies to optimize SQLite storage with appropriate indexes and encryption.

```javascript
// schema/socialMediaSchema.js
export const COLLECTIONS = {
  USERS: 'users',
  PROFILES: 'profiles', 
  FRIENDSHIPS: 'friendships',
  POSTS: 'posts'
};

export const COLLECTION_CONFIG = {
  [COLLECTIONS.USERS]: {
    // Index commonly queried fields, including nested paths
    indexes: [
      'email', 
      'username', 
      'createdAt',
      'preferences.notifications.email',
      'preferences.privacy.profileVisibility',
      'subscription.plan',
      'subscription.status'
    ],
    // Encrypt sensitive personal data (supports nested field paths)
    encryptedFields: [
      'email', 
      'passwordHash', 
      'phoneNumber',
      'personalInfo.ssn',
      'personalInfo.address.street',
      'personalInfo.address.zipCode',
      'paymentInfo.creditCard'
    ]
  },
  
  [COLLECTIONS.PROFILES]: {
    // Index fields used for search and filtering, including nested objects
    indexes: [
      'userId', 
      'displayName', 
      'location.city',
      'location.country', 
      'lastActive',
      'settings.theme',
      'demographics.ageGroup',
      'demographics.interests'
    ],
    // Encrypt private profile information with deeply nested paths
    encryptedFields: [
      'privateNotes', 
      'personalDetails.realName',
      'personalDetails.birthDate',
      'contactInfo.personalEmail',
      'contactInfo.emergencyContact.name',
      'contactInfo.emergencyContact.phone'
    ]
  },
  
  [COLLECTIONS.FRIENDSHIPS]: {
    // Index relationship fields for efficient friendship queries
    indexes: [
      'userId', 
      'friendId', 
      'status', 
      'createdAt',
      'metadata.mutualFriends',
      'metadata.connectionSource',
      'privacy.sharedWithFriend'
    ],
    // Usually no encryption needed for friendship metadata
    encryptedFields: []
  },
  
  [COLLECTIONS.POSTS]: {
    // Index for feed generation and user post listings with nested metadata
    indexes: [
      'authorId', 
      'createdAt', 
      'visibility', 
      'tags',
      'engagement.likes',
      'engagement.shares',
      'location.coordinates.lat',
      'location.coordinates.lng',
      'metadata.category',
      'metadata.contentType'
    ],
    // Encrypt private posts and sensitive nested content
    encryptedFields: [
      'content', 
      'privateMetadata.personalNotes',
      'location.exactAddress',
      'analytics.viewerData.personalizedContent'
    ]
  }
};
```

This schema configuration tells our storage system which fields to index for fast queries and which fields contain sensitive data that should be encrypted before storage.

## Implementing Encryption

For production applications, you'll want robust encryption. Here's an example using a simple XOR cipher for demonstration purposes, though you should use proper encryption libraries like `react-native-crypto-js` in real applications:

```javascript
// utils/encryption.js
import CryptoJS from 'crypto-js';

export class EncryptionManager {
  constructor(encryptionKey) {
    this.encryptionKey = encryptionKey;
  }
  
  encrypt(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    
    try {
      const encrypted = CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
      return encrypted;
    } catch (error) {
      console.error('Encryption failed:', error);
      return text;
    }
  }
  
  decrypt(encryptedText) {
    if (!encryptedText || typeof encryptedText !== 'string') {
      return encryptedText;
    }
    
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted || encryptedText;
    } catch (error) {
      console.error('Decryption failed:', error);
      return encryptedText;
    }
  }
}
```

## Creating the Storage Stack

Now we'll assemble the complete storage stack. The process involves creating the SQLite adapter, configuring the schema strategy, and injecting everything into the storage layer:

```javascript
// storage/createSocialMediaStorage.js
import * as SQLite from 'expo-sqlite';
import { 
  ExpoSqliteAdapter,
  SqliteStorage,
  CollectionPerTableStrategy 
} from '@shaxpir/sharedb-storage-expo-sqlite';
import { EncryptionManager } from '../utils/encryption';
import { COLLECTION_CONFIG } from '../schema/socialMediaSchema';

export async function createSocialMediaStorage(options = {}) {
  const {
    databaseName = 'social_media_app',
    encryptionKey = null,
    enableEncryption = false,
    debug = false
  } = options;

  // Create the Expo SQLite database connection
  const db = SQLite.openDatabase(databaseName);
  
  // Initialize the Expo SQLite adapter
  const adapter = new ExpoSqliteAdapter({
    database: db,
    debug: debug
  });

  // Set up encryption if enabled
  let encryptionManager = null;
  let encryptionCallback = null;
  let decryptionCallback = null;
  
  if (enableEncryption && encryptionKey) {
    encryptionManager = new EncryptionManager(encryptionKey);
    encryptionCallback = (text) => encryptionManager.encrypt(text);
    decryptionCallback = (encrypted) => encryptionManager.decrypt(encrypted);
  }

  // Create the collection-per-table schema strategy
  const schemaStrategy = new CollectionPerTableStrategy({
    collectionConfig: COLLECTION_CONFIG,
    useEncryption: enableEncryption,
    encryptionCallback: encryptionCallback,
    decryptionCallback: decryptionCallback,
    debug: debug
  });

  // Create the SQLite storage with our adapter and schema strategy
  const storage = new SqliteStorage({
    adapter: adapter,
    schemaStrategy: schemaStrategy,
    debug: debug
  });

  // Initialize the storage system
  return new Promise((resolve, reject) => {
    storage.initialize((err, inventory) => {
      if (err) {
        reject(new Error(`Failed to initialize storage: ${err.message}`));
      } else {
        resolve(storage);
      }
    });
  });
}
```

## Integrating with ShareDB Connection

Once you have your storage implementation, you need to integrate it with ShareDB's connection and DurableStore. This is where the dependency injection pattern shines:

```javascript
// services/ShareDBService.js
import ShareDB from '@shaxpir/sharedb/lib/client';
import DurableStore from '@shaxpir/sharedb/lib/client/durable-store';
import { createSocialMediaStorage } from '../storage/createSocialMediaStorage';

export class ShareDBService {
  constructor() {
    this.connection = null;
    this.storage = null;
    this.durableStore = null;
  }

  async initialize(options = {}) {
    const {
      websocketUrl = 'ws://localhost:8080',
      encryptionKey = 'your-encryption-key-here',
      enableEncryption = true,
      enableOffline = true
    } = options;

    try {
      // Create the storage implementation
      this.storage = await createSocialMediaStorage({
        databaseName: 'social_media_v1',
        encryptionKey: encryptionKey,
        enableEncryption: enableEncryption,
        debug: __DEV__
      });

      // Create the DurableStore with our storage implementation
      if (enableOffline) {
        this.durableStore = new DurableStore(this.storage, {
          debug: __DEV__
        });
      }

      // Create ShareDB connection
      this.connection = new ShareDB.Connection(websocketUrl);
      
      // Integrate DurableStore with the connection
      if (this.durableStore) {
        this.connection.useDurableStore(this.durableStore);
      }

      console.log('ShareDB service initialized successfully');
      return this.connection;
      
    } catch (error) {
      console.error('Failed to initialize ShareDB service:', error);
      throw error;
    }
  }

  // Helper methods for document operations
  getDocument(collection, id) {
    if (!this.connection) {
      throw new Error('ShareDB service not initialized');
    }
    return this.connection.get(collection, id);
  }

  createQuery(collection, query = {}) {
    if (!this.connection) {
      throw new Error('ShareDB service not initialized');
    }
    return this.connection.createQuery(collection, query);
  }

  async cleanup() {
    if (this.storage) {
      await this.storage.close();
    }
    if (this.connection) {
      this.connection.close();
    }
  }
}
```

## Document Lifecycle Management

The ShareDB service integrates into your app's lifecycle through document subscription patterns and operational transforms. Here's how you manage user profiles with real-time synchronization:

```javascript
// services/ProfileManager.js
import { ShareDBService } from '../services/ShareDBService';
import { COLLECTIONS } from '../schema/socialMediaSchema';

export class ProfileManager {
  constructor() {
    this.shareDBService = new ShareDBService();
    this.profileDoc = null;
    this.subscribers = new Set();
  }

  async initializeProfile(userId) {
    try {
      // Initialize with encryption for sensitive profile data
      await this.shareDBService.initialize({
        encryptionKey: 'user-specific-encryption-key',
        enableEncryption: true,
        enableOffline: true
      });

      // Get the profile document
      this.profileDoc = this.shareDBService.getDocument(COLLECTIONS.PROFILES, userId);
      
      // Subscribe to document changes
      this.profileDoc.subscribe((err) => {
        if (err) {
          console.error('Failed to subscribe to profile:', err);
          return;
        }

        // Initialize document if it doesn't exist
        if (!this.profileDoc.data) {
          const initialData = {
            userId: userId,
            displayName: '',
            location: {
              city: '',
              country: ''
            },
            lastActive: new Date().toISOString(),
            settings: {
              theme: 'light',
              notifications: true
            },
            personalDetails: {
              realName: '', // Encrypted field
              birthDate: ''  // Encrypted field
            },
            contactInfo: {
              personalEmail: '', // Encrypted field
              emergencyContact: {
                name: '',    // Encrypted field
                phone: ''    // Encrypted field
              }
            }
          };

          this.profileDoc.create(initialData, (createErr) => {
            if (createErr) {
              console.error('Failed to create profile:', createErr);
            } else {
              this.notifySubscribers();
            }
          });
        } else {
          this.notifySubscribers();
        }
      });

      return this.profileDoc;
    } catch (error) {
      throw new Error(`Failed to initialize profile: ${error.message}`);
    }
  }

  // Subscribe to profile changes
  subscribe(callback) {
    this.subscribers.add(callback);
    // Call immediately with current data if available
    if (this.profileDoc && this.profileDoc.data) {
      callback(this.profileDoc.data);
    }
    
    // Return unsubscribe function
    return () => this.subscribers.delete(callback);
  }

  notifySubscribers() {
    const data = this.profileDoc ? this.profileDoc.data : null;
    this.subscribers.forEach(callback => callback(data));
  }

  // Update profile with operational transforms
  updateProfile(changes) {
    if (!this.profileDoc || !this.profileDoc.data) {
      throw new Error('Profile not initialized');
    }

    const ops = [];
    const currentData = this.profileDoc.data;

    // Generate operations for each change
    Object.keys(changes).forEach(key => {
      if (key.includes('.')) {
        // Handle nested field updates
        const path = key.split('.');
        const currentValue = this.getNestedValue(currentData, path);
        if (currentValue !== changes[key]) {
          ops.push({ p: path, od: currentValue, oi: changes[key] });
        }
      } else {
        // Handle top-level field updates
        if (currentData[key] !== changes[key]) {
          ops.push({ p: [key], od: currentData[key], oi: changes[key] });
        }
      }
    });

    // Always update lastActive timestamp
    ops.push({ 
      p: ['lastActive'], 
      od: currentData.lastActive, 
      oi: new Date().toISOString() 
    });

    if (ops.length > 0) {
      return new Promise((resolve, reject) => {
        this.profileDoc.submitOp(ops, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(this.profileDoc.data);
          }
        });
      });
    }

    return Promise.resolve(currentData);
  }

  getNestedValue(obj, path) {
    return path.reduce((current, key) => current && current[key], obj);
  }

  async cleanup() {
    if (this.profileDoc) {
      this.profileDoc.unsubscribe();
    }
    await this.shareDBService.cleanup();
  }
}
```

## Relationship Management with Optimized Queries

The collection-per-table schema strategy automatically creates indexes on the fields you specified, making complex relationship queries efficient. Here's how you implement friendship management:

```javascript
// services/FriendshipManager.js
import { ShareDBService } from '../services/ShareDBService';
import { COLLECTIONS } from '../schema/socialMediaSchema';

export class FriendshipManager {
  constructor() {
    this.shareDBService = new ShareDBService();
    this.friendsQuery = null;
    this.pendingRequestsQuery = null;
    this.friendsCallbacks = new Set();
    this.requestsCallbacks = new Set();
  }

  async initializeFriendships(currentUserId) {
    try {
      await this.shareDBService.initialize();

      // Query for confirmed friendships
      // The indexes on 'userId' and 'status' make this query efficient
      this.friendsQuery = this.shareDBService.createQuery(COLLECTIONS.FRIENDSHIPS, {
        userId: currentUserId,
        status: 'confirmed'
      });

      this.friendsQuery.subscribe((err) => {
        if (err) {
          console.error('Failed to subscribe to friends query:', err);
          return;
        }
        
        const friends = this.friendsQuery.results || [];
        this.friendsCallbacks.forEach(callback => callback(friends));
      });

      // Query for incoming friend requests
      // The indexes on 'friendId' and 'status' optimize this lookup
      this.pendingRequestsQuery = this.shareDBService.createQuery(COLLECTIONS.FRIENDSHIPS, {
        friendId: currentUserId,
        status: 'pending'
      });

      this.pendingRequestsQuery.subscribe((err) => {
        if (err) {
          console.error('Failed to subscribe to pending requests:', err);
          return;
        }
        
        const requests = this.pendingRequestsQuery.results || [];
        this.requestsCallbacks.forEach(callback => callback(requests));
      });

    } catch (error) {
      console.error('Failed to initialize friendships:', error);
      throw error;
    }
  }

  // Subscribe to friends list changes
  subscribeFriends(callback) {
    this.friendsCallbacks.add(callback);
    if (this.friendsQuery && this.friendsQuery.results) {
      callback(this.friendsQuery.results);
    }
    return () => this.friendsCallbacks.delete(callback);
  }

  // Subscribe to pending requests changes
  subscribePendingRequests(callback) {
    this.requestsCallbacks.add(callback);
    if (this.pendingRequestsQuery && this.pendingRequestsQuery.results) {
      callback(this.pendingRequestsQuery.results);
    }
    return () => this.requestsCallbacks.delete(callback);
  }

  async sendFriendRequest(currentUserId, friendId) {
    const friendshipId = `${currentUserId}_${friendId}`;
    const friendshipDoc = this.shareDBService.getDocument(COLLECTIONS.FRIENDSHIPS, friendshipId);
    
    const friendshipData = {
      userId: currentUserId,
      friendId: friendId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: {
        mutualFriends: [], // Will be populated by backend
        connectionSource: 'manual_request'
      }
    };

    return new Promise((resolve, reject) => {
      friendshipDoc.create(friendshipData, (err) => {
        if (err) {
          reject(new Error(`Failed to send friend request: ${err.message}`));
        } else {
          resolve(friendshipDoc.data);
        }
      });
    });
  }

  async acceptFriendRequest(friendshipId) {
    const friendshipDoc = this.shareDBService.getDocument(COLLECTIONS.FRIENDSHIPS, friendshipId);
    
    return new Promise((resolve, reject) => {
      friendshipDoc.submitOp([{
        p: ['status'],
        od: 'pending',
        oi: 'confirmed'
      }, {
        p: ['confirmedAt'],
        oi: new Date().toISOString()
      }], (err) => {
        if (err) {
          reject(new Error(`Failed to accept friend request: ${err.message}`));
        } else {
          resolve(friendshipDoc.data);
        }
      });
    });
  }

  async removeFriend(friendshipId) {
    const friendshipDoc = this.shareDBService.getDocument(COLLECTIONS.FRIENDSHIPS, friendshipId);
    
    return new Promise((resolve, reject) => {
      friendshipDoc.del((err) => {
        if (err) {
          reject(new Error(`Failed to remove friend: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async cleanup() {
    if (this.friendsQuery) {
      this.friendsQuery.unsubscribe();
    }
    if (this.pendingRequestsQuery) {
      this.pendingRequestsQuery.unsubscribe();
    }
    await this.shareDBService.cleanup();
  }
}
```

## Content Management with Selective Encryption

The content management system demonstrates encryption of sensitive posts while maintaining query performance for public content. Here's how you implement a news feed with privacy controls:

```javascript
// services/ContentManager.js
import { ShareDBService } from '../services/ShareDBService';
import { COLLECTIONS } from '../schema/socialMediaSchema';

export class ContentManager {
  constructor() {
    this.shareDBService = new ShareDBService();
    this.publicFeedQuery = null;
    this.userPostsQuery = null;
    this.feedCallbacks = new Set();
    this.userPostsCallbacks = new Set();
  }

  async initializeContentFeed(currentUserId) {
    try {
      await this.shareDBService.initialize({
        enableEncryption: true,
        encryptionKey: 'content-encryption-key'
      });

      // Query for public posts in the user's feed
      // The indexes on 'visibility' and 'createdAt' make this efficient
      this.publicFeedQuery = this.shareDBService.createQuery(COLLECTIONS.POSTS, {
        visibility: 'public'
      });

      this.publicFeedQuery.subscribe((err) => {
        if (err) {
          console.error('Failed to load public feed:', err);
          return;
        }

        // Sort posts by engagement and recency
        const sortedPosts = (this.publicFeedQuery.results || []).sort((a, b) => {
          const aEngagement = (a.data.engagement?.likes || 0) + (a.data.engagement?.shares || 0);
          const bEngagement = (b.data.engagement?.likes || 0) + (b.data.engagement?.shares || 0);
          
          // Weight by engagement and recency
          const aScore = aEngagement + (new Date(a.data.createdAt).getTime() / 100000);
          const bScore = bEngagement + (new Date(b.data.createdAt).getTime() / 100000);
          
          return bScore - aScore;
        });
        
        this.feedCallbacks.forEach(callback => callback(sortedPosts));
      });

      // Query for user's own posts (including private ones)
      this.userPostsQuery = this.shareDBService.createQuery(COLLECTIONS.POSTS, {
        authorId: currentUserId
      });

      this.userPostsQuery.subscribe((err) => {
        if (err) {
          console.error('Failed to load user posts:', err);
          return;
        }

        const userPosts = (this.userPostsQuery.results || []).sort((a, b) => 
          new Date(b.data.createdAt) - new Date(a.data.createdAt)
        );
        
        this.userPostsCallbacks.forEach(callback => callback(userPosts));
      });

    } catch (error) {
      console.error('Failed to initialize content feed:', error);
      throw error;
    }
  }

  // Subscribe to public feed updates
  subscribeFeed(callback) {
    this.feedCallbacks.add(callback);
    if (this.publicFeedQuery && this.publicFeedQuery.results) {
      callback(this.publicFeedQuery.results);
    }
    return () => this.feedCallbacks.delete(callback);
  }

  // Subscribe to user's posts updates
  subscribeUserPosts(callback) {
    this.userPostsCallbacks.add(callback);
    if (this.userPostsQuery && this.userPostsQuery.results) {
      callback(this.userPostsQuery.results);
    }
    return () => this.userPostsCallbacks.delete(callback);
  }

  async createPost(authorId, content, options = {}) {
    const {
      visibility = 'public',
      location = null,
      category = 'general'
    } = options;

    const postId = `${authorId}_${Date.now()}`;
    const postDoc = this.shareDBService.getDocument(COLLECTIONS.POSTS, postId);
    
    const postData = {
      authorId: authorId,
      content: content, // Automatically encrypted if visibility is 'private'
      visibility: visibility,
      createdAt: new Date().toISOString(),
      tags: this.extractHashtags(content),
      engagement: {
        likes: 0,
        shares: 0,
        comments: 0
      },
      location: location ? {
        coordinates: {
          lat: location.lat,
          lng: location.lng
        },
        exactAddress: location.address // This field will be encrypted
      } : null,
      metadata: {
        category: category,
        contentType: this.detectContentType(content)
      },
      // Private metadata - encrypted for sensitive analytics
      privateMetadata: visibility === 'private' ? {
        personalNotes: 'This is a private post',
        sensitiveContent: true
      } : null,
      // Analytics data - encrypted to protect user behavior patterns  
      analytics: {
        viewerData: {
          personalizedContent: `Analytics for ${authorId}` // Encrypted field
        }
      }
    };

    return new Promise((resolve, reject) => {
      postDoc.create(postData, (err) => {
        if (err) {
          reject(new Error(`Failed to create post: ${err.message}`));
        } else {
          resolve(postDoc.data);
        }
      });
    });
  }

  async updateEngagement(postId, engagementType, increment = 1) {
    const postDoc = this.shareDBService.getDocument(COLLECTIONS.POSTS, postId);
    
    return new Promise((resolve, reject) => {
      // Wait for document to load if needed
      postDoc.subscribe((err) => {
        if (err) {
          reject(err);
          return;
        }

        if (!postDoc.data) {
          reject(new Error('Post not found'));
          return;
        }

        const currentValue = postDoc.data.engagement[engagementType] || 0;
        
        postDoc.submitOp([{
          p: ['engagement', engagementType],
          od: currentValue,
          oi: currentValue + increment
        }], (opErr) => {
          if (opErr) {
            reject(new Error(`Failed to update engagement: ${opErr.message}`));
          } else {
            resolve(postDoc.data);
          }
        });
      });
    });
  }

  extractHashtags(text) {
    const hashtags = text.match(/#\w+/g);
    return hashtags ? hashtags.map(tag => tag.substring(1)) : [];
  }

  detectContentType(content) {
    if (content.includes('http')) return 'link';
    if (content.includes('#')) return 'tagged';
    if (content.length > 500) return 'long_form';
    return 'text';
  }

  async cleanup() {
    if (this.publicFeedQuery) {
      this.publicFeedQuery.unsubscribe();
    }
    if (this.userPostsQuery) {
      this.userPostsQuery.unsubscribe();
    }
    await this.shareDBService.cleanup();
  }
}
```

## Integration with React Native Components

These service classes integrate seamlessly into your React Native components through standard patterns. Your components can subscribe to data changes using the service callback methods, which automatically update when ShareDB documents change. For example:

- **ProfileManager** integrates with profile screens by calling `profileManager.subscribe(callback)` in useEffect hooks
- **FriendshipManager** powers friend list components by subscribing to both friends and pending requests
- **ContentManager** drives feed screens by subscribing to the public feed and user posts queries

The callback-based subscription pattern ensures your UI automatically updates when documents change locally or sync from the server. Each service provides cleanup methods to properly unsubscribe and close database connections when components unmount.

For offline scenarios, the DurableStore queues operations and syncs them when connectivity returns. Your UI remains responsive and functional throughout, providing a seamless user experience regardless of network conditions.

## Database Schema and Performance

Behind the scenes, the CollectionPerTableStrategy creates optimized SQLite tables for each collection. The system supports deep JSON path indexing using dot notation, allowing you to create indexes on deeply nested fields for optimal query performance.

For our social media schema, it generates tables like:

```sql
-- Users table with indexes on both top-level and deeply nested fields
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE INDEX idx_users_email ON users (json_extract(data, '$.email'));
CREATE INDEX idx_users_username ON users (json_extract(data, '$.username'));
CREATE INDEX idx_users_createdAt ON users (json_extract(data, '$.createdAt'));

-- Indexes on deeply nested preference fields
CREATE INDEX idx_users_preferences_notifications_email ON users (json_extract(data, '$.preferences.notifications.email'));
CREATE INDEX idx_users_preferences_privacy_profileVisibility ON users (json_extract(data, '$.preferences.privacy.profileVisibility'));
CREATE INDEX idx_users_subscription_plan ON users (json_extract(data, '$.subscription.plan'));
CREATE INDEX idx_users_subscription_status ON users (json_extract(data, '$.subscription.status'));

-- Profiles table with location and demographic indexing
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE INDEX idx_profiles_userId ON profiles (json_extract(data, '$.userId'));
CREATE INDEX idx_profiles_displayName ON profiles (json_extract(data, '$.displayName'));
CREATE INDEX idx_profiles_location_city ON profiles (json_extract(data, '$.location.city'));
CREATE INDEX idx_profiles_location_country ON profiles (json_extract(data, '$.location.country'));
CREATE INDEX idx_profiles_demographics_ageGroup ON profiles (json_extract(data, '$.demographics.ageGroup'));

-- Posts table with engagement and location coordinate indexing
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE INDEX idx_posts_authorId ON posts (json_extract(data, '$.authorId'));
CREATE INDEX idx_posts_createdAt ON posts (json_extract(data, '$.createdAt'));
CREATE INDEX idx_posts_engagement_likes ON posts (json_extract(data, '$.engagement.likes'));
CREATE INDEX idx_posts_location_coordinates_lat ON posts (json_extract(data, '$.location.coordinates.lat'));
CREATE INDEX idx_posts_location_coordinates_lng ON posts (json_extract(data, '$.location.coordinates.lng'));
CREATE INDEX idx_posts_metadata_category ON posts (json_extract(data, '$.metadata.category'));
```

### Nested Field Encryption

The encryption system also supports deep JSON paths. When you specify encrypted fields like `personalInfo.address.street` or `contactInfo.emergencyContact.phone`, the system:

1. **Traverses the JSON structure** to find the specified nested field
2. **Applies encryption selectively** only to the specified nested values
3. **Preserves the JSON structure** while encrypting individual field values
4. **Maintains queryability** of non-encrypted sibling fields

For example, with this document:
```json
{
  "personalInfo": {
    "name": "John Doe",
    "address": {
      "street": "123 Secret Lane",
      "city": "Public City",
      "zipCode": "12345"
    }
  }
}
```

If you encrypt `personalInfo.address.street` and `personalInfo.address.zipCode`, the stored document becomes:
```json
{
  "personalInfo": {
    "name": "John Doe",
    "address": {
      "street": "[ENCRYPTED_DATA]",
      "city": "Public City", 
      "zipCode": "[ENCRYPTED_DATA]"
    }
  }
}
```

This allows you to still query and index on `personalInfo.name` and `personalInfo.address.city` while keeping sensitive address details encrypted.

## Conclusion

This implementation provides a robust, offline-first data layer for React Native applications. The pluggable architecture allows you to switch between storage implementations easily, while the schema strategies optimize database performance for your specific use cases. Encryption ensures sensitive data remains protected, and the automatic indexing makes complex queries performant even with large datasets.

The system handles offline scenarios gracefully, queuing operations when disconnected and syncing changes when connectivity returns. This creates a seamless user experience while maintaining data consistency across devices and users.