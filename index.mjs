#!/usr/bin/env node

import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import semver from 'semver';
import os from 'os';

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
    // Use --quiet to avoid printing credentials in logs
    await executeCommand('git', ['clone', '--quiet', repoUrl, targetDir]);
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
 * Get repository URL from package.json
 * @param {string} packageDir - Path to the package directory
 * @returns {Promise<string|null>} - Repository URL or null if not found
 */
const getRepositoryUrl = async (packageDir) => {
  try {
    const packageJsonPath = join(packageDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    
    if (packageJson.repository) {
      if (typeof packageJson.repository === 'string') {
        return packageJson.repository;
      } else if (packageJson.repository.url) {
        return packageJson.repository.url;
      }
    }
    return null;
  } catch (error) {
    console.warn(`Warning: Could not get repository URL for ${packageDir}: ${error.message}`);
    return null;
  }
};

/**
 * Get commit history between two versions
 * @param {string} repoUrl - Repository URL
 * @param {string} oldVersion - Old version
 * @param {string} newVersion - New version
 * @returns {Promise<Array>} - Array of commit objects
 */
const getCommitHistory = async (repoUrl, oldVersion, newVersion) => {
  try {
    // Create a temporary directory for the repository
    const tempDir = join(os.tmpdir(), `repo-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    
    // Clone the repository
    console.log(`Cloning ${repoUrl} to get commit history...`);
    // Use --quiet to avoid printing credentials in logs
    await executeCommand('git', ['clone', '--quiet', repoUrl, tempDir]);
    
    // Fetch all tags to ensure we have the version references
    await executeCommand('git', ['fetch', '--tags', '--force'], tempDir);
    
    // Check if versions exist as tags by adding v prefix if needed
    let oldRef = oldVersion;
    let newRef = newVersion;
    
    // Try to resolve the references
    const checkRef = async (ref) => {
      try {
        // Try to get the commit hash for the reference
        const result = await executeCommand('git', ['rev-parse', '--verify', ref], tempDir);
        return result.trim();
      } catch (error) {
        // If not found, try with 'v' prefix
        if (!ref.startsWith('v')) {
          try {
            const result = await executeCommand('git', ['rev-parse', '--verify', `v${ref}`], tempDir);
            return `v${ref}`;
          } catch (e) {
            // Neither version found
            return null;
          }
        }
        return null;
      }
    };
    
    // Resolve references
    const resolvedOldRef = await checkRef(oldRef);
    const resolvedNewRef = await checkRef(newRef);
    
    if (!resolvedOldRef) {
      console.warn(`Warning: Could not find reference for ${oldVersion} in repository`);
      return [];
    }
    
    if (!resolvedNewRef) {
      console.warn(`Warning: Could not find reference for ${newVersion} in repository`);
      return [];
    }
    
    // Get commit history between versions
    // Format: hash,author,date,message
    console.log(`Getting commits between ${resolvedOldRef} and ${resolvedNewRef}...`);
    const output = await executeCommand(
      'git', 
      ['log', `${resolvedOldRef}..${resolvedNewRef}`, '--pretty=format:%H,%an,%ad,%s'], 
      tempDir
    );
    
    // Parse the output
    const commits = output.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, date, ...messageParts] = line.split(',');
        return { 
          hash, 
          author, 
          date, 
          message: messageParts.join(',') // Rejoin message parts in case it contained commas
        };
      });
    
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
    
    return commits;
  } catch (error) {
    console.warn(`Warning: Could not get commit history for ${repoUrl} between ${oldVersion} and ${newVersion}: ${error.message}`);
    return [];
  }
};

/**
 * Get changelog for upgraded dependencies
 * @param {Array} upgradedDeps - Array of upgraded dependencies
 * @param {string} newerVersionDir - Directory of the newer version
 * @returns {Promise<Object>} - Object mapping package names to changelogs
 */
const getChangelogs = async (upgradedDeps, newerVersionDir) => {
  const changelogs = {};
  
  for (const dep of upgradedDeps) {
    const packageDir = join(newerVersionDir, 'node_modules', dep.name);
    const repoUrl = await getRepositoryUrl(packageDir);
    
    if (repoUrl) {
      // Clean the repository URL and convert to git URL for authentication
      let cleanRepoUrl = repoUrl.replace(/^git\+/, '');
      
      // Remove .git extension if present (we'll add it back later if needed)
      cleanRepoUrl = cleanRepoUrl.replace(/\.git$/, '');
      
      // Handle GitHub shorthand (github:user/repo)
      if (cleanRepoUrl.match(/^(github|gitlab|bitbucket):/)) {
        cleanRepoUrl = `git@github.com:${cleanRepoUrl.split(':')[1]}`;
      }
      // Convert https GitHub URLs to git URLs
      else if (cleanRepoUrl.match(/^https?:\/\/github\.com\//)) {
        cleanRepoUrl = `git@github.com:${cleanRepoUrl.replace(/^https?:\/\/github\.com\//, '')}`;
      }
      
      // Add .git extension if not present
      if (!cleanRepoUrl.endsWith('.git')) {
        cleanRepoUrl += '.git';
      }
      
      console.log(`Getting changelog for ${dep.name} from ${cleanRepoUrl} between ${dep.oldVersion} and ${dep.newVersion}`);
      
      try {
        const commits = await getCommitHistory(cleanRepoUrl, dep.oldVersion, dep.newVersion);
        if (commits.length > 0) {
          changelogs[dep.name] = {
            repoUrl: cleanRepoUrl,
            oldVersion: dep.oldVersion,
            newVersion: dep.newVersion,
            commits
          };
        } else {
          console.warn(`No commits found between ${dep.oldVersion} and ${dep.newVersion} for ${dep.name}`);
        }
      } catch (error) {
        console.warn(`Error getting changelog for ${dep.name}: ${error.message}`);
      }
    }
  }
  
  return changelogs;
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
    
    // Get changelogs for upgraded dependencies
    console.log('Generating changelogs for upgraded dependencies...');
    const changelogs = await getChangelogs(comparison.upgraded, newerVersionDir);
    
    // Create report
    const report = {
      repository: repoUrl,
      olderVersion: olderVersion,
      newerVersion: newerVersion,
      timestamp: new Date().toISOString(),
      changes: comparison,
      changelogs
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
    const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir);
    
    console.log('\nSummary:');
    console.log(`Added dependencies: ${report.changes.added.length}`);
    console.log(`Upgraded dependencies: ${report.changes.upgraded.length}`);
    console.log(`Removed dependencies: ${report.changes.removed.length}`);
    
    const changelogCount = Object.keys(report.changelogs).length;
    console.log(`Generated changelogs for ${changelogCount} upgraded dependencies`);
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
