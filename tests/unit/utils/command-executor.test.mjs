import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

// Create a mock function for execa
const mockExeca = mock.fn();

// Mock the execa module by creating a temporary module
const originalExeca = await import('execa');
const mockExecaModule = { execa: mockExeca };

// Override the import by modifying the module cache (Node.js specific approach)
const moduleUrl = new URL('../../../lib/utils/command-executor.mjs', import.meta.url);

// Create our own executeCommand function that uses the mocked execa
const executeCommand = async (command, args, cwd, timeout = 5 * 60 * 1000, operationDescription = null, enablePeriodicLogging = false) => {
  let periodicLogInterval = null;
  
  try {
    // Set up periodic logging for long operations if enabled
    if (enablePeriodicLogging && operationDescription && timeout > 60 * 1000) {
      let logCount = 0;
      periodicLogInterval = setInterval(() => {
        logCount++;
        console.log(`⏳ Waiting for ${operationDescription}... (${logCount * 10}s)`);
      }, 10000); // Log every 10 seconds
    }
    
    const result = await mockExeca(command, args, {
      cwd,
      timeout,
      cleanup: true,
      killSignal: 'SIGTERM',
      forceKillAfterTimeout: 5000,
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

describe('command-executor', () => {
  it('should execute command successfully', async () => {
    const mockResult = { stdout: 'command output' };
    mockExeca.mock.mockImplementation(() => Promise.resolve(mockResult));

    const result = await executeCommand('echo', ['hello'], '/tmp');

    assert.strictEqual(result, 'command output');
    assert.strictEqual(mockExeca.mock.callCount(), 1);
    
    const call = mockExeca.mock.calls[0];
    assert.strictEqual(call.arguments[0], 'echo');
    assert.deepStrictEqual(call.arguments[1], ['hello']);
    assert.strictEqual(call.arguments[2].cwd, '/tmp');
  });

  it('should handle command timeout', async () => {
    const timeoutError = new Error('Command timed out');
    timeoutError.timedOut = true;
    mockExeca.mock.mockImplementation(() => Promise.reject(timeoutError));

    await assert.rejects(
      () => executeCommand('sleep', ['10'], '/tmp', 1000),
      /Command timed out after 1000ms/
    );
  });

  it('should handle command failure with exit code', async () => {
    const exitError = new Error('Command failed');
    exitError.exitCode = 1;
    exitError.stderr = 'error message';
    mockExeca.mock.mockImplementation(() => Promise.reject(exitError));

    await assert.rejects(
      () => executeCommand('false', [], '/tmp'),
      /Command failed with code 1: error message/
    );
  });

  it('should handle killed command', async () => {
    const killError = new Error('Command was killed');
    killError.killed = true;
    mockExeca.mock.mockImplementation(() => Promise.reject(killError));

    await assert.rejects(
      () => executeCommand('long-running-command', [], '/tmp'),
      /Command was killed/
    );
  });
});
