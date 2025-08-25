# ShareDB Operational Transform (OT) Types Guide

ShareDB's power comes from its pluggable Operational Transform (OT) type system. This guide explains how different OT types work, when to use them, and how to implement custom types for specialized collaborative editing scenarios.

## Understanding Operational Transforms

Operational Transforms enable real-time collaborative editing by transforming concurrent operations so they can be applied in any order while maintaining document consistency. Each OT type defines how to represent, apply, compose, and transform operations for a specific data structure.

ShareDB supports multiple OT implementations out of the box and allows you to create custom types for specialized use cases.

## Built-in OT Types

### JSON0 - Structured Data Editing

JSON0 is ShareDB's default OT type, designed for collaborative editing of arbitrary JSON documents. It uses path-based operations to modify nested data structures.

```typescript
import ShareDB from '@shaxpir/sharedb';

// Create a document with JSON0 (default type)
const doc = connection.get('documents', 'doc1');

// Create initial data structure
const initialData = {
  title: 'Meeting Notes',
  participants: ['Alice', 'Bob'],
  agenda: {
    topics: ['Budget Review', 'Project Timeline'],
    duration: 60
  },
  completed: false
};

doc.create(initialData, (error) => {
  if (error) throw error;
  console.log('Document created with JSON0 type');
});
```

**JSON0 Operation Examples:**

```typescript
// Object operations - modify properties
const objectOps: ShareDB.Json0Op[] = [
  // Change title
  { p: ['title'], od: 'Meeting Notes', oi: 'Sprint Planning' },
  
  // Add new property
  { p: ['priority'], oi: 'high' },
  
  // Delete property
  { p: ['completed'], od: false }
];

// Array operations - modify lists
const arrayOps: ShareDB.Json0Op[] = [
  // Insert item at end of participants array
  { p: ['participants', 2], li: 'Charlie' },
  
  // Delete first agenda topic
  { p: ['agenda', 'topics', 0], ld: 'Budget Review' },
  
  // Move item (delete + insert)
  { p: ['agenda', 'topics', 1], lm: 0 }
];

// Number operations - increment/decrement
const numberOps: ShareDB.Json0Op[] = [
  // Increase duration by 30 minutes
  { p: ['agenda', 'duration'], na: 30 }
];

// String operations - insert/delete characters
const stringOps: ShareDB.Json0Op[] = [
  // Insert text at position 8 in title
  { p: ['title', 8], si: ' Session' },
  
  // Delete 4 characters starting at position 0
  { p: ['title', 0], sd: 'Meet' }
];

// Apply operations
doc.submitOp(objectOps);
doc.submitOp(arrayOps);
doc.submitOp(numberOps);
doc.submitOp(stringOps);
```

**When to use JSON0:**
- Collaborative forms and structured data editing
- Configuration files and settings management
- Real-time dashboards with multiple data fields
- Any scenario requiring concurrent modification of JSON structures

### Rich Text - Advanced Text Editing

Rich Text OT type handles formatted text with attributes like bold, italic, links, and custom styling. It's ideal for building collaborative editors like Google Docs or Notion.

```typescript
import RichText from '@shaxpir/rich-text';

// Register rich-text type
ShareDB.types.register(RichText.type);

// Create rich text document
const textDoc = connection.get('articles', 'article1');

const initialContent = [
  { insert: 'Welcome to ShareDB\n', attributes: { header: 1 } },
  { insert: 'This is a ' },
  { insert: 'collaborative', attributes: { bold: true } },
  { insert: ' rich text editor built with ' },
  { insert: 'ShareDB', attributes: { italic: true, link: 'https://github.com/share/sharedb' } },
  { insert: '.' }
];

textDoc.create(initialContent, RichText.type, (error) => {
  if (error) throw error;
  console.log('Rich text document created');
});
```

**Rich Text Operation Examples:**

```typescript
// Text insertion with formatting
const insertOps: ShareDB.RichTextOp[] = [
  // Keep first 20 characters
  { retain: 20 },
  
  // Insert bold text
  { insert: ' Amazing', attributes: { bold: true } },
  
  // Keep rest of document
  { retain: Infinity }
];

// Format existing text
const formatOps: ShareDB.RichTextOp[] = [
  { retain: 30 },
  
  // Make next 12 characters italic and add underline
  { retain: 12, attributes: { italic: true, underline: true } },
  
  { retain: Infinity }
];

// Delete text
const deleteOps: ShareDB.RichTextOp[] = [
  { retain: 50 },
  
  // Delete 10 characters
  { delete: 10 },
  
  { retain: Infinity }
];

// Complex editing - replace text with different formatting
const complexOps: ShareDB.RichTextOp[] = [
  { retain: 25 },
  
  // Delete old text
  { delete: 13 }, // Remove 'collaborative'
  
  // Insert new formatted text
  { insert: 'real-time', attributes: { bold: true, color: '#0066cc' } },
  
  { retain: Infinity }
];

// Apply operations
textDoc.submitOp(insertOps);
textDoc.submitOp(formatOps);
textDoc.submitOp(deleteOps);
textDoc.submitOp(complexOps);
```

**Rich Text Features:**
- **Attributes**: bold, italic, underline, color, font-size, links
- **Block-level formatting**: headers, lists, quotes, code blocks
- **Embeds**: images, videos, custom components
- **Custom attributes**: application-specific formatting

**When to use Rich Text:**
- Collaborative document editors (Google Docs style)
- Content management systems
- Blog post editors with multiple authors
- Real-time note-taking applications

### Plain Text - Simple Text Editing

The Text OT type handles plain text editing without formatting. It's optimized for performance and simplicity.

```typescript
import TextType from 'ot-text';

// Register text type  
ShareDB.types.register(TextType);

// Create plain text document
const codeDoc = connection.get('code', 'app.js');

const initialCode = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`;

codeDoc.create(initialCode, TextType, (error) => {
  if (error) throw error;
  console.log('Code document created');
});
```

**Plain Text Operation Examples:**

```typescript
// Insert code at specific position
const insertCode: ShareDB.TextOp[] = [
  // Keep first 50 characters
  { retain: 50 },
  
  // Insert memoization
  { insert: '\n  // Memoization for performance\n  if (memo[n]) return memo[n];\n' },
  
  // Keep rest
  { retain: Infinity }
];

// Delete and replace function
const refactorOps: ShareDB.TextOp[] = [
  // Keep function name
  { retain: 17 },
  
  // Delete old implementation
  { delete: 85 },
  
  // Insert iterative implementation
  { insert: `{
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}` },
  
  { retain: Infinity }
];

// Apply operations
codeDoc.submitOp(insertCode);
codeDoc.submitOp(refactorOps);
```

**When to use Plain Text:**
- Code editors and IDEs
- Chat applications
- Simple note-taking
- Configuration file editing
- Any text-only collaborative editing

## Creating Custom OT Types

Custom OT types allow you to create specialized collaborative data structures. Here's how to build a custom type for collaborative pixel art editing:

```typescript
// Custom OT type for pixel art canvas
interface PixelArtSnapshot {
  width: number;
  height: number;
  pixels: { [coordinate: string]: string }; // "x,y" -> color
}

interface PixelOp {
  type: 'setPixel' | 'clearPixel' | 'resize';
  x?: number;
  y?: number;
  color?: string;
  width?: number;
  height?: number;
}

const PixelArtType: ShareDB.OTType = {
  name: 'pixel-art',
  uri: 'https://example.com/ot-types/pixel-art',

  // Create initial canvas
  create(initialData?: Partial<PixelArtSnapshot>): PixelArtSnapshot {
    return {
      width: initialData?.width || 32,
      height: initialData?.height || 32,
      pixels: initialData?.pixels || {}
    };
  },

  // Apply operations to canvas
  apply(snapshot: PixelArtSnapshot, ops: PixelOp[]): PixelArtSnapshot {
    const newSnapshot = {
      ...snapshot,
      pixels: { ...snapshot.pixels }
    };

    for (const op of ops) {
      switch (op.type) {
        case 'setPixel':
          if (op.x !== undefined && op.y !== undefined && op.color) {
            newSnapshot.pixels[`${op.x},${op.y}`] = op.color;
          }
          break;
          
        case 'clearPixel':
          if (op.x !== undefined && op.y !== undefined) {
            delete newSnapshot.pixels[`${op.x},${op.y}`];
          }
          break;
          
        case 'resize':
          if (op.width !== undefined) newSnapshot.width = op.width;
          if (op.height !== undefined) newSnapshot.height = op.height;
          // Clear pixels outside new bounds
          Object.keys(newSnapshot.pixels).forEach(coord => {
            const [x, y] = coord.split(',').map(Number);
            if (x >= newSnapshot.width || y >= newSnapshot.height) {
              delete newSnapshot.pixels[coord];
            }
          });
          break;
      }
    }

    return newSnapshot;
  },

  // Compose two operation sequences
  compose(ops1: PixelOp[], ops2: PixelOp[]): PixelOp[] {
    // Simple composition - later operations override earlier ones
    const combined = [...ops1, ...ops2];
    const pixelOps = new Map<string, PixelOp>();
    let resizeOp: PixelOp | null = null;

    // Collapse pixel operations
    for (const op of combined) {
      if (op.type === 'resize') {
        resizeOp = { ...resizeOp, ...op };
      } else if (op.x !== undefined && op.y !== undefined) {
        const coord = `${op.x},${op.y}`;
        pixelOps.set(coord, op);
      }
    }

    const result: PixelOp[] = [...pixelOps.values()];
    if (resizeOp) result.push(resizeOp);
    
    return result;
  },

  // Transform operations for concurrent editing
  transform(ops1: PixelOp[], ops2: PixelOp[], priority: 'left' | 'right'): PixelOp[] {
    // For pixel art, operations are mostly independent
    // Only conflict resolution needed is for same pixel
    const transformed: PixelOp[] = [];

    for (const op1 of ops1) {
      let shouldInclude = true;

      // Check for conflicts with ops2
      for (const op2 of ops2) {
        if (op1.type !== 'resize' && op2.type !== 'resize' &&
            op1.x === op2.x && op1.y === op2.y) {
          // Same pixel modified - use priority
          if (priority === 'right') {
            shouldInclude = false;
          }
          break;
        }
      }

      if (shouldInclude) {
        transformed.push(op1);
      }
    }

    return transformed;
  },

  // Optional: Generate diff between two snapshots
  diff(oldSnapshot: PixelArtSnapshot, newSnapshot: PixelArtSnapshot): PixelOp[] {
    const ops: PixelOp[] = [];

    // Check for resize
    if (oldSnapshot.width !== newSnapshot.width || 
        oldSnapshot.height !== newSnapshot.height) {
      ops.push({
        type: 'resize',
        width: newSnapshot.width,
        height: newSnapshot.height
      });
    }

    // Check for pixel changes
    const allCoords = new Set([
      ...Object.keys(oldSnapshot.pixels),
      ...Object.keys(newSnapshot.pixels)
    ]);

    for (const coord of allCoords) {
      const [x, y] = coord.split(',').map(Number);
      const oldColor = oldSnapshot.pixels[coord];
      const newColor = newSnapshot.pixels[coord];

      if (oldColor !== newColor) {
        if (newColor) {
          ops.push({ type: 'setPixel', x, y, color: newColor });
        } else {
          ops.push({ type: 'clearPixel', x, y });
        }
      }
    }

    return ops;
  }
};

// Register the custom type
ShareDB.types.register(PixelArtType);
```

**Using the Custom Pixel Art Type:**

```typescript
// Create pixel art canvas
const canvasDoc = connection.get('artwork', 'canvas1');

canvasDoc.create({ width: 16, height: 16 }, 'pixel-art', (error) => {
  if (error) throw error;
  console.log('Pixel art canvas created');
});

// Draw some pixels
const drawOps: PixelOp[] = [
  { type: 'setPixel', x: 5, y: 5, color: '#ff0000' },
  { type: 'setPixel', x: 6, y: 5, color: '#ff0000' },
  { type: 'setPixel', x: 5, y: 6, color: '#00ff00' },
  { type: 'setPixel', x: 6, y: 6, color: '#0000ff' }
];

canvasDoc.submitOp(drawOps, (error) => {
  if (error) throw error;
  console.log('Pixels drawn:', canvasDoc.data);
});

// Resize canvas
const resizeOps: PixelOp[] = [
  { type: 'resize', width: 32, height: 32 }
];

canvasDoc.submitOp(resizeOps);
```

## OT Type Selection Guide

### Choose JSON0 when you need:
- **Structured data editing**: Forms, configurations, metadata
- **Nested object manipulation**: Complex document structures
- **Mixed data types**: Numbers, strings, arrays, objects together
- **Path-based operations**: Precise targeting of nested properties

### Choose Rich Text when you need:
- **Formatted text editing**: Bold, italic, colors, fonts
- **Block formatting**: Headers, lists, quotes
- **Collaborative writing**: Multi-user document editing
- **Rich media**: Images, links, embeds

### Choose Plain Text when you need:
- **Performance**: Large text documents with frequent edits
- **Simplicity**: No formatting complexity
- **Code editing**: Syntax highlighting handled separately
- **Chat applications**: Real-time text with minimal overhead

### Create Custom Types when you need:
- **Domain-specific data**: Specialized collaborative structures
- **Performance optimization**: Operations tailored to your use case
- **Complex transformations**: Business logic in OT operations
- **Novel interaction patterns**: New ways of collaborative editing

## Best Practices

### Operation Design
```typescript
// Good: Atomic, composable operations
const goodOps: ShareDB.Json0Op[] = [
  { p: ['status'], od: 'draft', oi: 'published' },
  { p: ['publishedAt'], oi: new Date().toISOString() }
];

// Avoid: Operations that depend on complex state
const avoidOps = [
  // This requires knowing current array length
  { p: ['items', 'length'], na: 1 }
];
```

### Error Handling
```typescript
doc.submitOp(operations, (error) => {
  if (error) {
    switch (error.code) {
      case 4001: // ERR_DOC_ALREADY_CREATED
        console.log('Document already exists');
        break;
      case 4002: // ERR_DOC_DOES_NOT_EXIST
        console.log('Document not found');
        break;
      case 4003: // ERR_DOC_TYPE_NOT_RECOGNIZED  
        console.log('Unknown OT type');
        break;
      case 4010: // ERR_OP_APPLY_FAILED
        console.log('Operation could not be applied');
        break;
      default:
        console.error('Unexpected error:', error);
    }
  }
});
```

### Performance Optimization
```typescript
// Batch related operations together
const batchOps: ShareDB.Json0Op[] = [
  { p: ['title'], od: oldTitle, oi: newTitle },
  { p: ['updatedAt'], od: oldDate, oi: newDate },
  { p: ['author'], od: oldAuthor, oi: newAuthor }
];

doc.submitOp(batchOps); // Single round-trip

// Avoid: Multiple separate operations
// doc.submitOp([{ p: ['title'], od: oldTitle, oi: newTitle }]);
// doc.submitOp([{ p: ['updatedAt'], od: oldDate, oi: newDate }]);
// doc.submitOp([{ p: ['author'], od: oldAuthor, oi: newAuthor }]);
```

## Testing OT Types

```typescript
// Test custom OT type behavior
function testPixelArtType() {
  const canvas = PixelArtType.create({ width: 4, height: 4 });
  
  // Test basic operations
  const ops: PixelOp[] = [
    { type: 'setPixel', x: 1, y: 1, color: '#ff0000' },
    { type: 'setPixel', x: 2, y: 2, color: '#00ff00' }
  ];
  
  const result = PixelArtType.apply(canvas, ops);
  
  console.assert(result.pixels['1,1'] === '#ff0000', 'Red pixel set');
  console.assert(result.pixels['2,2'] === '#00ff00', 'Green pixel set');
  
  // Test transform
  const ops1: PixelOp[] = [{ type: 'setPixel', x: 0, y: 0, color: '#red' }];
  const ops2: PixelOp[] = [{ type: 'setPixel', x: 0, y: 0, color: '#blue' }];
  
  const transformed = PixelArtType.transform(ops1, ops2, 'left');
  console.assert(transformed.length === 1, 'Transform preserves left priority');
  
  console.log('Custom OT type tests passed!');
}

testPixelArtType();
```

This guide provides a comprehensive foundation for understanding and working with ShareDB's OT type system. Whether you're using built-in types for common scenarios or creating custom types for specialized applications, the key is understanding how operations represent changes and how they compose and transform to enable seamless real-time collaboration.