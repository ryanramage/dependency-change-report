import { rm } from 'fs/promises';

// Global cleanup state
let globalCleanupState = {
  multibar: null,
  tempDirs: new Set(),
  isShuttingDown: false
};

// Ensure process signal listeners are attached only once, even if multiple
// analyses run in the same process (serially or in parallel). process.on is
// additive, so re-registering would attach duplicate listeners.
let handlersInstalled = false;

/**
 * Setup signal handlers for graceful shutdown
 */
export const setupSignalHandlers = () => {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;

  const cleanup = async (signal) => {
    if (globalCleanupState.isShuttingDown) {
      return;
    }
    
    globalCleanupState.isShuttingDown = true;
    console.log(`\n\n🛑 Received ${signal}, cleaning up...`);
    
    // Stop progress bars and restore cursor
    if (globalCleanupState.multibar) {
      try {
        globalCleanupState.multibar.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Restore cursor and clear any progress bar artifacts
    process.stdout.write('\x1b[?25h'); // Show cursor
    process.stdout.write('\x1b[0m');   // Reset colors
    
    // Clean up temporary directories
    const cleanupPromises = Array.from(globalCleanupState.tempDirs).map(async (dir) => {
      try {
        await rm(dir, { recursive: true, force: true });
        console.log(`🗑️  Cleaned up: ${dir}`);
      } catch (error) {
        console.warn(`⚠️  Failed to clean up ${dir}: ${error.message}`);
      }
    });
    
    if (cleanupPromises.length > 0) {
      console.log(`🧹 Cleaning up ${cleanupPromises.length} temporary directories...`);
      await Promise.all(cleanupPromises);
    }
    
    console.log('✅ Cleanup complete');
    process.exit(signal === 'SIGTERM' ? 0 : 1);
  };
  
  // Handle various termination signals
  process.on('SIGINT', () => cleanup('SIGINT'));   // Ctrl+C
  process.on('SIGTERM', () => cleanup('SIGTERM')); // Termination request
  process.on('SIGHUP', () => cleanup('SIGHUP'));   // Terminal closed
  
  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', async (error) => {
    console.error('\n💥 Uncaught Exception:', error);
    await cleanup('uncaughtException');
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
    await cleanup('unhandledRejection');
  });
};

/**
 * Register a temporary directory for cleanup
 * @param {string} dir - Directory path to register for cleanup
 */
export const registerTempDir = (dir) => {
  globalCleanupState.tempDirs.add(dir);
};

/**
 * Unregister a temporary directory from cleanup (when manually cleaned)
 * @param {string} dir - Directory path to unregister
 */
export const unregisterTempDir = (dir) => {
  globalCleanupState.tempDirs.delete(dir);
};

/**
 * Set the multibar instance for cleanup
 * @param {Object} multibar - CLI progress multibar instance
 */
export const setMultibar = (multibar) => {
  globalCleanupState.multibar = multibar;
};

/**
 * Clear the multibar instance from cleanup
 */
export const clearMultibar = () => {
  globalCleanupState.multibar = null;
};
