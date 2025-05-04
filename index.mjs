#!/usr/bin/env node

import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import semver from 'semver';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Execute a command and return its output
 * @param {string} command - The command to execute
 * @param {string[]} args - Arguments for the command
 * @param {string} cwd - Working directory
 * @returns {Promise<string>} - Command output
 */
const executeCommand = (command, args, cwd) => {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        console.warn(`Warning: Command ${command} ${args.join(' ')} failed with code ${code}`);
        console.warn(`Error: ${stderr}`);
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
};

/**
 * Clone a GitHub repository at a specific reference
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref - Git reference (tag, branch, commit)
 * @param {string} targetDir - Directory to clone into
 * @returns {Promise<void>}
 */
const cloneRepo = async (repoUrl, ref, targetDir) => {
  try {
    console.log(`Cloning ${repoUrl} at ${ref} into ${targetDir}...`);
    await executeCommand('git', ['clone', repoUrl, targetDir]);
    await executeCommand('git', ['checkout', ref], targetDir);
  } catch (error) {
    console.warn(`Warning: Failed to clone or checkout repository: ${error.message}`);
    throw error;
  }
};

/**
 * Install npm dependencies
 * @param {string} dir - Directory containing package.json
 * @returns {Promise<void>}
 */
const installDependencies = async (dir) => {
  try {
    console.log(`Installing dependencies in ${dir}...`);
    await executeCommand('npm', ['install'], dir);
  } catch (error) {
    console.warn(`Warning: Failed to install dependencies: ${error.message}`);
    throw error;
  }
};

/**
 * Get npm dependencies
 * @param {string} dir - Directory containing node_modules
 * @returns {Promise<Object>} - Dependencies object
 */
const getDependencies = async (dir) => {
  try {
    console.log(`Getting dependency list from ${dir}...`);
    const output = await executeCommand('npm', ['ls', '--all', '--omit=dev', '--json'], dir);
    return JSON.parse(output).dependencies || {};
  } catch (error) {
    console.warn(`Warning: Failed to get dependencies: ${error.message}`);
    // Return empty object if we can't get dependencies
    return {};
  }
};

/**
 * Compare dependencies between two versions
 * @param {Object} oldDeps - Old dependencies
 * @param {Object} newDeps - New dependencies
 * @returns {Object} - Comparison result
 */
const compareDependencies = (oldDeps, newDeps) => {
  const added = [];
  const removed = [];
  const upgraded = [];

  // Find added and upgraded dependencies
  for (const [name, info] of Object.entries(newDeps)) {
    if (!oldDeps[name]) {
      added.push({ name, version: info.version });
    } else if (oldDeps[name].version !== info.version) {
      const oldVersion = oldDeps[name].version;
      const newVersion = info.version;
      
      let changeType = 'unknown';
      try {
        if (semver.valid(oldVersion) && semver.valid(newVersion)) {
          if (semver.major(newVersion) > semver.major(oldVersion)) {
            changeType = 'major';
          } else if (semver.minor(newVersion) > semver.minor(oldVersion)) {
            changeType = 'minor';
          } else if (semver.patch(newVersion) > semver.patch(oldVersion)) {
            changeType = 'patch';
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not determine semver change type for ${name}: ${error.message}`);
      }

      upgraded.push({
        name,
        oldVersion,
        newVersion,
        changeType
      });
    }
  }

  // Find removed dependencies
  for (const name of Object.keys(oldDeps)) {
    if (!newDeps[name]) {
      removed.push({ name, version: oldDeps[name].version });
    }
  }

  return { added, removed, upgraded };
};

/**
 * Main function to analyze dependency changes between two versions
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref1 - First git reference
 * @param {string} ref2 - Second git reference
 * @param {string} workingDir - Working directory (optional)
 * @returns {Promise<Object>} - Analysis report
 */
const analyzeDependencyChanges = async (repoUrl, olderVersion, newerVersion, workingDir = process.cwd()) => {
  // Extract project name from repo URL
  const projectName = basename(repoUrl, '.git');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reposDir = join(workingDir, `${projectName}-${timestamp}`);
  
  const olderVersionDir = join(reposDir, `${olderVersion}`);
  const newerVersionDir = join(reposDir, `${newerVersion}`);
  
  try {
    // Create the repos directory
    await mkdir(reposDir, { recursive: true });
    
    // Clone both versions
    await cloneRepo(repoUrl, olderVersion, olderVersionDir);
    await cloneRepo(repoUrl, newerVersion, newerVersionDir);
    
    // Install dependencies for both versions
    await installDependencies(olderVersionDir);
    await installDependencies(newerVersionDir);
    
    // Get dependencies for both versions
    const olderDeps = await getDependencies(olderVersionDir);
    const newerDeps = await getDependencies(newerVersionDir);
    
    // Compare dependencies
    const comparison = compareDependencies(olderDeps, newerDeps);
    
    // Create report
    const report = {
      repository: repoUrl,
      olderVersion: olderVersion,
      newerVersion: newerVersion,
      timestamp: new Date().toISOString(),
      changes: comparison
    };
    
    // Write report to file
    const reportPath = join(reposDir, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`Report generated at ${reportPath}`);
    return report;
  } catch (error) {
    console.error(`Error analyzing dependency changes: ${error.message}`);
    throw error;
  }
};

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
      console.error('Usage: node index.mjs <github-repo> <older-version> <newer-version> [working-dir]');
      console.error('  <older-version> and <newer-version> can be any git reference (tag, branch, commit)');
      process.exit(1);
    }
    
    const [repoUrl, olderVersion, newerVersion, workingDir] = args;
    
    console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);
    const report = await analyzeDependencyChanges(repoUrl, ref1, ref2, workingDir);
    
    console.log('\nSummary:');
    console.log(`Added dependencies: ${report.changes.added.length}`);
    console.log(`Upgraded dependencies: ${report.changes.upgraded.length}`);
    console.log(`Removed dependencies: ${report.changes.removed.length}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function if this file is executed directly
if (import.meta.url === `file://${__filename}`) {
  main();
}

export { analyzeDependencyChanges };
