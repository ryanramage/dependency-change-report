import { execa } from 'execa';

const time_10min = 10 * 60 * 1000; // 10 minutes in milliseconds
const time_5min = 5 * 60 * 1000; // 5 minutes in milliseconds
const time_2min = 2 * 60 * 1000; // 2 minutes in milliseconds
const time_1min = 60 * 1000; // 1 minute in milliseconds

/**
 * Execute a command and return its output
 * @param {string} command - The command to execute
 * @param {string[]} args - Arguments for the command
 * @param {string} cwd - Working directory
 * @param {number} timeout - Timeout in milliseconds (default: 5 minutes)
 * @param {string} operationDescription - Description of the operation for logging (optional)
 * @param {boolean} enablePeriodicLogging - Whether to enable periodic logging for long operations
 * @returns {Promise<string>} - Command output
 */
export const executeCommand = async (command, args, cwd, timeout = time_5min, operationDescription = null, enablePeriodicLogging = false) => {
  let periodicLogInterval = null;
  
  try {
    // Set up periodic logging for long operations if enabled
    if (enablePeriodicLogging && operationDescription && timeout > time_1min) {
      let logCount = 0;
      periodicLogInterval = setInterval(() => {
        logCount++;
        console.log(`⏳ Waiting for ${operationDescription}... (${logCount * 10}s)`);
      }, 10000); // Log every 10 seconds
    }
    
    const result = await execa(command, args, {
      cwd,
      timeout,
      cleanup: true,
      killSignal: 'SIGTERM',
      forceKillAfterTimeout: 5000, // Force kill after 5 seconds if SIGTERM doesn't work
      stdio: 'pipe'
    });
    
    // Clear periodic logging
    if (periodicLogInterval) {
      clearInterval(periodicLogInterval);
      periodicLogInterval = null;
    }
    
    return result.stdout;
  } catch (error) {
    // Clear periodic logging on error
    if (periodicLogInterval) {
      clearInterval(periodicLogInterval);
      periodicLogInterval = null;
    }
    
    if (error.timedOut) {
      throw new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`);
    } else if (error.killed) {
      throw new Error(`Command was killed: ${command} ${args.join(' ')}`);
    } else if (error.exitCode !== 0) {
      throw new Error(`Command failed with code ${error.exitCode}: ${error.stderr}`);
    } else {
      throw error;
    }
  }
};

export { time_10min, time_5min, time_2min, time_1min };
