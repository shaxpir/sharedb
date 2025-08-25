/**
 * ShareDB SharedWorker Script
 * 
 * This script runs in a SharedWorker context and hosts the real ShareDB Connection
 * and DurableStore. It communicates with tabs via BroadcastChannel.
 * 
 * To use this script:
 * 1. Copy this file to your public directory
 * 2. Update the importScripts path to point to your ShareDB bundle
 * 3. Create SharedWorker: new SharedWorker('/sharedb-shared-worker.js', 'sharedb-proxy')
 */

// Import ShareDB modules
// Note: In a real application, you would bundle ShareDB or import from a CDN
// This is a template - adjust the import path as needed
try {
  // Try to import ShareDB - adjust this path for your application
  importScripts('/sharedb-client-bundle.js'); // Your bundled ShareDB client code
} catch (error) {
  console.error('Failed to import ShareDB in SharedWorker:', error);
  console.error('Please ensure sharedb-client-bundle.js is available and contains the required modules');
  
  // Without ShareDB modules, we can't proceed
  throw new Error('ShareDB modules not available in SharedWorker');
}

// Verify required modules are available
if (typeof SharedWorkerManager === 'undefined') {
  console.error('SharedWorkerManager not found. Please ensure it is included in your ShareDB bundle.');
  throw new Error('SharedWorkerManager not available');
}

// Initialize SharedWorkerManager with default configuration
console.log('Initializing ShareDB SharedWorker...');

var manager = new SharedWorkerManager({
  debug: true, // Enable debug logging in development
  channelName: 'sharedb-proxy' // Must match the channel name used in tabs
});

// Make manager globally available for debugging
self.shareDBManager = manager;

// Log successful initialization
console.log('ShareDB SharedWorker initialized successfully');
console.log('Manager stats:', manager.getStats());

// Handle worker errors
self.onerror = function(error) {
  console.error('SharedWorker error:', error);
};

// Handle unhandled promise rejections
self.onunhandledrejection = function(event) {
  console.error('SharedWorker unhandled promise rejection:', event.reason);
};

// Optional: Periodic stats logging for debugging
if (manager.debug) {
  setInterval(function() {
    var stats = manager.getStats();
    console.log('ShareDB SharedWorker stats:', stats);
  }, 30000); // Log stats every 30 seconds
}

console.log('ShareDB SharedWorker script loaded and running');