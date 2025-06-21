import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

// Mock execa before importing the module
const mockExeca = mock.fn();
mock.module('execa', () => ({ execa: mockExeca }));

// Now import the module under test
const { executeCommand } = await import('../../../lib/utils/command-executor.mjs');

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
