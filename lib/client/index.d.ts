// Type definitions for ShareDB Client
// Project: https://github.com/share/sharedb
// Definitions by: Claude Code <https://claude.ai/code>

export * from '../../index';

// Re-export client-specific classes for easier importing
import { 
  Connection as ConnectionClass,
  Doc as DocClass,
  Query as QueryClass
} from '../../index';

export const Connection: typeof ConnectionClass;
export const Doc: typeof DocClass;
export const Query: typeof QueryClass;