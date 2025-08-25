// Type definitions for ShareDB Client
// Project: https://github.com/share/sharedb
// Definitions by: Claude Code <https://claude.ai/code>

import ShareDB from '../../index';

// Re-export the main ShareDB class as default
export = ShareDB;

// Named exports for client-specific classes
export const Connection: ShareDB.ConnectionStatic;
export const Doc: ShareDB.DocStatic;
export const Query: ShareDB.QueryStatic;