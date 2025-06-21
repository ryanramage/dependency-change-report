import cliProgress from 'cli-progress';
import { setMultibar, clearMultibar } from './cleanup-manager.mjs';

/**
 * Create a multi-progress bar for tracking multiple operations
 * @param {number} dependencyCount - Number of dependencies to track
 * @returns {Object|null} - Multibar instance or null if disabled
 */
export const createMultiProgressBar = (dependencyCount) => {
  // Detect small screen and disable progress bars if needed
  const terminalHeight = process.stdout.rows || 24;
  const terminalWidth = process.stdout.columns || 80;
  const isSmallScreen = terminalHeight < 15 || terminalWidth < 60 || dependencyCount > (terminalHeight - 10);
  
  if (isSmallScreen) {
    console.log(`\nProcessing ${dependencyCount} dependencies:`);
    console.log('(Progress bars disabled for small screen or large dependency count)\n');
    return null;
  }
  
  // Create multi progress bar
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    forceRedraw: true,
    format: '{name} |{bar}| {percentage}% | {status}'
  }, {
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591'
  });
  
  // Register multibar for cleanup
  setMultibar(multibar);
  
  console.log(`\nProcessing ${dependencyCount} dependencies:\n`);
  
  return multibar;
};

/**
 * Stop and cleanup a multi-progress bar
 * @param {Object} multibar - Multibar instance to stop
 */
export const stopMultiProgressBar = (multibar) => {
  if (multibar) {
    multibar.stop();
    clearMultibar();
    
    // Ensure cursor is visible after progress bars
    process.stdout.write('\x1b[?25h'); // Show cursor
  }
};

/**
 * Check if we should use progress bars based on screen size and dependency count
 * @param {number} dependencyCount - Number of dependencies
 * @returns {boolean} - Whether to use progress bars
 */
export const shouldUseProgressBars = (dependencyCount) => {
  const terminalHeight = process.stdout.rows || 24;
  const terminalWidth = process.stdout.columns || 80;
  return !(terminalHeight < 15 || terminalWidth < 60 || dependencyCount > (terminalHeight - 10));
};
