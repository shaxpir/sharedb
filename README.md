# ShareDB

  [![NPM Version](https://img.shields.io/npm/v/sharedb.svg)](https://npmjs.org/package/sharedb)
  ![Test](https://github.com/shaxpir/sharedb/workflows/Test/badge.svg)
  [![Coverage Status](https://coveralls.io/repos/github/shaxpir/sharedb/badge.svg?branch=master)](https://coveralls.io/github/shaxpir/sharedb?branch=master)

## Shaxpir: Enhanced ShareDB with DurableStore

This is the **Shaxpir fork** of ShareDB, which introduces a new **DurableStore** system for offline-first client persistence. The DurableStore allows clients to persist documents and operations in the browser's IndexedDB storage, enabling:

- **Complete offline capability** - Users can work entirely offline, with operations queued for sync upon reconnection
- **Multi-document working sets** - Persist multiple documents with pending operations across browsing sessions  
- **Transparent operation sync** - Offline operations automatically sync to ShareDB when connectivity returns
- **Client-side persistence** - Documents remain available even after closing and reopening the application

The DurableStore system is a **unique enhancement** not available in the original upstream ShareDB, specifically designed for offline-first collaborative applications.

## Introduction

ShareDB is a realtime database backend based on [Operational Transformation
(OT)](https://en.wikipedia.org/wiki/Operational_transformation) of JSON
documents. It is the realtime backend for the [DerbyJS web application
framework](http://derbyjs.com/).

For help, questions, discussion and announcements, join the [ShareJS mailing
list](https://groups.google.com/forum/?fromgroups#!forum/sharejs) or [read the documentation](https://share.github.io/sharedb/
).

Please report any bugs you find to the [issue
tracker](https://github.com/shaxpir/sharedb/issues).

## Features

 - Realtime synchronization of any JSON document
 - Concurrent multi-user collaboration
 - Synchronous editing API with asynchronous eventual consistency
 - Realtime query subscriptions
 - Simple integration with any database
 - Horizontally scalable with pub/sub integration
 - Projections to select desired fields from documents and operations
 - Middleware for implementing access control and custom extensions
 - Ideal for use in browsers or on the server
 - Offline change syncing upon reconnection
 - **Bulk document operations** for efficient multi-document loading and writing
 - **Advanced offline persistence** with DurableStore and pluggable storage layers
 - **Caller-controlled batch writing** with auto-flush control
 - In-memory implementations of database and pub/sub for unit testing
 - Access to historic document versions
 - Realtime user presence syncing

## React Native Support

For React Native applications using the **DurableStore** system, use the dedicated package:

- **[@shaxpir/sharedb-storage-expo-sqlite](https://github.com/shaxpir/sharedb-storage-expo-sqlite)** - Expo SQLite storage adapter specifically designed for DurableStore offline persistence

This package provides **DurableStore integration** with:
- Client-side document persistence using Expo SQLite
- Offline operation queuing and automatic sync
- Pre-initialized database support for complex architectures  
- Dual-database integration (builtin + userdata schemas)
- Connection pooling with dependency injection
- Cross-database queries for analytics
- Zero bundling conflicts with browser/Node.js apps

The React Native storage package enables the full DurableStore offline-first experience on mobile platforms.

## Documentation

https://share.github.io/sharedb/

## Examples

### Counter

[<img src="examples/counter/demo.gif" height="300">](examples/counter)

### Leaderboard

[<img src="examples/leaderboard/demo.gif" height="436">](examples/leaderboard)

## Development

### Documentation

The documentation is stored as Markdown files, but sometimes it can be useful to run these locally. The docs are served using [Jekyll](https://jekyllrb.com/), and require Ruby >2.4.0 and [Bundler](https://bundler.io/):

```bash
gem install jekyll bundler
```

The docs can be built locally and served with live reload:

```bash
npm run docs:install
npm run docs:start
```
