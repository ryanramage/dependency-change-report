#!/usr/bin/env node

import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import semver from 'semver';
import os from 'os';
import https from 'https';
import { execa } from 'execa';
import cliProgress from 'cli-progress';
import PQueue from 'p-queue';

const time_10min = 10 * 60 * 1000; // 10 minutes in milliseconds
const time_5min = 5 * 60 * 1000; // 5 minutes in milliseconds
const time_2min = 2 * 60 * 1000; // 2 minutes in milliseconds
const time_1min = 60 * 1000; // 1 minute in milliseconds

// Global cleanup state
let globalCleanupState = {
  multibar: null,
  tempDirs: new Set(),
  isShuttingDown: false
};

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Setup signal handlers for graceful shutdown
 */
const setupSignalHandlers = () => {
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
const registerTempDir = (dir) => {
  globalCleanupState.tempDirs.add(dir);
};

/**
 * Unregister a temporary directory from cleanup (when manually cleaned)
 * @param {string} dir - Directory path to unregister
 */
const unregisterTempDir = (dir) => {
  globalCleanupState.tempDirs.delete(dir);
};

/**
 * Execute a command and return its output
 * @param {string} command - The command to execute
 * @param {string[]} args - Arguments for the command
 * @param {string} cwd - Working directory
 * @param {number} timeout - Timeout in milliseconds (default: 5 minutes)
 * @returns {Promise<string>} - Command output
 */
const executeCommand = async (command, args, cwd, timeout = time_5min) => {
  try {
    const result = await execa(command, args, {
      cwd,
      timeout,
      cleanup: true,
      killSignal: 'SIGTERM',
      forceKillAfterTimeout: 5000, // Force kill after 5 seconds if SIGTERM doesn't work
      stdio: 'pipe'
    });
    
    return result.stdout;
  } catch (error) {
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

/**
 * Clone a GitHub repository at a specific reference
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref - Git reference (tag, branch, commit)
 * @param {string} targetDir - Directory to clone into
 * @returns {Promise<void>}
 */
const cloneRepo = async (repoUrl, ref, targetDir) => {
  try {
    // Use shallow clone with depth=1 and single-branch for faster cloning
    // Use --quiet to avoid printing credentials in logs
    // 2 minute timeout for very large repositories
    await executeCommand('git', ['clone', '--quiet', '--depth=1', '--single-branch', '--branch', ref, repoUrl, targetDir], undefined, time_2min);
  } catch (error) {
    // If shallow clone with specific branch fails, try traditional approach
    try {
      // Full clone with 5 minute timeout for very large repos
      await executeCommand('git', ['clone', '--quiet', repoUrl, targetDir], undefined, time_5min);
      await executeCommand('git', ['checkout', ref], targetDir, time_1min);
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
};

/**
 * Install npm dependencies
 * @param {string} dir - Directory containing package.json
 * @returns {Promise<void>}
 */
const installDependencies = async (dir) => {
  try {
    await executeCommand('npm', ['install'], dir);
  } catch (error) {
    throw error;
  }
};

/**
 * Get npm dependencies
 * @param {string} dir - Directory containing node_modules
 * @param {string} namespace - Optional namespace to filter second-level dependencies
 * @returns {Promise<Object>} - Dependencies object
 */
const getDependencies = async (dir, namespace = null) => {
  try {
    const output = await executeCommand('npm', ['ls', '--all', '--omit=dev', '--json'], dir);
    const dependencies = JSON.parse(output).dependencies || {};
    
    // Enhance dependencies with repository information
    for (const [name, info] of Object.entries(dependencies)) {
      try {
        const packageDir = join(dir, 'node_modules', name);
        const packageJsonPath = join(packageDir, 'package.json');
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
        
        // Extract repository URL
        if (packageJson.repository) {
          if (typeof packageJson.repository === 'string') {
            info.repository = packageJson.repository;
          } else if (packageJson.repository.url) {
            info.repository = packageJson.repository.url;
          }
        }
        
        // Get second-level dependencies if they exist
        if (packageJson.dependencies) {
          // Get the nested dependencies
          const nestedDeps = {};
          for (const [nestedName, nestedVersion] of Object.entries(packageJson.dependencies)) {
            // If namespace is provided, only include dependencies in that namespace
            if (!namespace || nestedName.startsWith(namespace)) {
              try {
                const nestedPackageDir = join(dir, 'node_modules', nestedName);
                const nestedPackageJsonPath = join(nestedPackageDir, 'package.json');
                const nestedPackageJson = JSON.parse(await readFile(nestedPackageJsonPath, 'utf8'));
                
                nestedDeps[nestedName] = { 
                  version: nestedVersion,
                  repository: null
                };
                
                // Extract repository URL for nested dependency
                if (nestedPackageJson.repository) {
                  if (typeof nestedPackageJson.repository === 'string') {
                    nestedDeps[nestedName].repository = nestedPackageJson.repository;
                  } else if (nestedPackageJson.repository.url) {
                    nestedDeps[nestedName].repository = nestedPackageJson.repository.url;
                  }
                }
              } catch (err) {
                // Silently skip nested dependencies we can't read
              }
            }
          }
          
          // Only add nested dependencies if there are any (after filtering)
          if (Object.keys(nestedDeps).length > 0) {
            info.dependencies = nestedDeps;
          }
        }
      } catch (err) {
        // Silently skip dependencies we can't read
      }
    }
    
    return dependencies;
  } catch (error) {
    // Silently return empty object if we can't get dependencies
    // Return empty object if we can't get dependencies
    return {};
  }
};

/**
 * Get GitHub Actions status for a specific commit/tag
 * @param {string} repoUrl - Repository URL
 * @param {string} version - Version/tag to check
 * @param {string} commitSha - Optional commit SHA if already known
 * @returns {Promise<Object|null>} - GitHub Actions status or null
 */
const getGitHubActionsStatus = async (repoUrl, version, commitSha = null) => {
  try {
    // Check if it's a GitHub repository
    if (!repoUrl.includes('github.com')) {
      return null;
    }
    
    // Extract owner and repo from URL
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) {
      return null;
    }
    
    const [, owner, repo] = match;
    
    // Use provided commit SHA or try to resolve it
    if (!commitSha) {
      
      // Try to get commit SHA from GitHub API for the tag/ref
      
      try {
        const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${version}`;
        const refData = await makeGitHubApiRequest(refUrl);
        
        if (refData && refData.object) {
          if (refData.object.type === 'commit') {
            commitSha = refData.object.sha;
          } else if (refData.object.type === 'tag') {
            // It's an annotated tag, get the commit it points to
            const tagData = await makeGitHubApiRequest(refData.object.url);
            if (tagData && tagData.object && tagData.object.type === 'commit') {
              commitSha = tagData.object.sha;
            }
          }
        }
      } catch (error) {
        // If tag doesn't exist, try as a branch or commit
        try {
          const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${version}`;
          const refData = await makeGitHubApiRequest(refUrl);
          if (refData && refData.object && refData.object.type === 'commit') {
            commitSha = refData.object.sha;
          }
        } catch (branchError) {
          // Try as direct commit SHA
          if (version.match(/^[a-f0-9]{7,40}$/i)) {
            commitSha = version;
          }
        }
      }
      
      if (!commitSha) {
        return {
          status: 'unknown',
          error: 'Could not find commit SHA for version'
        };
      }
    }
    
    // Get workflow runs for the commit
    const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${commitSha}`;
    const runsData = await makeGitHubApiRequest(runsUrl);
    
    if (!runsData || !runsData.workflow_runs || runsData.workflow_runs.length === 0) {
      return {
        status: 'no_workflows',
        message: 'No GitHub Actions workflows found for this commit'
      };
    }
    
    // Analyze the workflow runs
    const runs = runsData.workflow_runs;
    const latestRun = runs[0]; // Most recent run
    
    // Count statuses
    const statusCounts = {
      success: 0,
      failure: 0,
      in_progress: 0,
      cancelled: 0,
      skipped: 0,
      other: 0
    };
    
    runs.forEach(run => {
      switch (run.conclusion || run.status) {
        case 'success':
          statusCounts.success++;
          break;
        case 'failure':
        case 'timed_out':
          statusCounts.failure++;
          break;
        case 'in_progress':
        case 'queued':
        case 'pending':
          statusCounts.in_progress++;
          break;
        case 'cancelled':
          statusCounts.cancelled++;
          break;
        case 'skipped':
          statusCounts.skipped++;
          break;
        default:
          statusCounts.other++;
      }
    });
    
    // Determine overall status
    let overallStatus = 'success';
    if (statusCounts.failure > 0) {
      overallStatus = 'failure';
    } else if (statusCounts.in_progress > 0) {
      overallStatus = 'in_progress';
    } else if (statusCounts.success === 0 && statusCounts.cancelled > 0) {
      overallStatus = 'cancelled';
    } else if (statusCounts.success === 0) {
      overallStatus = 'unknown';
    }
    
    return {
      status: overallStatus,
      commitSha: commitSha.substring(0, 7),
      totalRuns: runs.length,
      statusCounts,
      latestRun: {
        id: latestRun.id,
        name: latestRun.name,
        status: latestRun.status,
        conclusion: latestRun.conclusion,
        url: latestRun.html_url,
        createdAt: latestRun.created_at,
        updatedAt: latestRun.updated_at
      },
      actionsUrl: `https://github.com/${owner}/${repo}/actions/runs?query=sha%3A${commitSha}`
    };
    
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

/**
 * Make a request to GitHub API
 * @param {string} url - API URL
 * @returns {Promise<Object>} - API response data
 */
const makeGitHubApiRequest = (url) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'dependency-analyzer/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const req = https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else if (res.statusCode === 404) {
            resolve(null); // Not found
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('GitHub API request timed out'));
    });
  });
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
    
    // If no repository URL is found, try to infer it from the package name
    if (packageJson.name) {
      // Handle scoped packages like @holepunchto/keet-core-api
      if (packageJson.name.startsWith('@')) {
        const [scope, packageName] = packageJson.name.substring(1).split('/');
        if (scope && packageName) {
          console.log(`No repository URL found for ${packageJson.name}, inferring from package name...`);
          return `git@github.com:${scope}/${packageName}.git`;
        }
      } else {
        // For non-scoped packages, assume it's directly on GitHub with the same name
        console.log(`No repository URL found for ${packageJson.name}, inferring from package name...`);
        return `git@github.com:${packageJson.name}/${packageJson.name}.git`;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
};

/**
 * Get commit history between two versions
 * @param {string} repoUrl - Repository URL
 * @param {string} oldVersion - Old version
 * @param {string} newVersion - New version
 * @param {string} reposDir - Repository directory
 * @returns {Promise<Array>} - Array of commit objects
 */
const getCommitHistory = async (repoUrl, oldVersion, newVersion, reposDir) => {
  let tempDir = null;
  
  try {
    // Create a directory for the repository within the repos directory
    const packageName = basename(repoUrl, '.git');
    tempDir = join(reposDir, `${packageName}-history`);
    await mkdir(tempDir, { recursive: true });
    
    // Register this temp directory for cleanup
    registerTempDir(tempDir);
    
    // Clone the repository with optimizations for faster cloning
    // Use --quiet to avoid printing credentials in logs
    // Use --depth=1 and --single-branch for faster cloning, then fetch what we need
    try {
      // 2 minute timeout for very large repositories
      await executeCommand('git', ['clone', '--quiet', '--depth=1', '--single-branch', repoUrl, tempDir], undefined, time_2min);
    } catch (error) {
      // If the repository doesn't exist or can't be accessed, throw a more specific error
      if (error.message.includes("Repository not found") || 
          error.message.includes("Could not read from remote repository") ||
          error.message.includes("timed out")) {
        throw new Error(`Repository not found, inaccessible, or clone timed out: ${error.message}`);
      }
      throw error;
    }
    
    // Fetch all tags to ensure we have the version references
    try {
      // 2 minute timeout for fetching tags from large repositories
      await executeCommand('git', ['fetch', '--tags', '--force', '--unshallow'], tempDir, time_2min);
    } catch (error) {
      // Continue without tags if fetch fails
    }
    
    // Clean and validate version strings
    const cleanVersion = (version) => {
      // Remove any git special characters that could cause issues
      return version.replace(/[\^~]/g, '').trim();
    };
    
    // Check if versions exist as tags by adding v prefix if needed
    let oldRef = cleanVersion(oldVersion);
    let newRef = cleanVersion(newVersion);
    
    // Try to resolve the references
    const checkRef = async (ref) => {
      // Make sure we're in the right directory and have fetched everything
      try {
        await executeCommand('git', ['fetch', '--all'], tempDir, time_1min); // 1 minute timeout
      } catch (error) {
        // Continue without full fetch
      }
      
      // List of reference patterns to try
      const refPatterns = [
        ref,                    // Direct reference
        `v${ref}`,             // With v prefix
        `refs/tags/${ref}`,    // As tag
        `refs/tags/v${ref}`,   // As tag with v prefix
        `origin/${ref}`,       // As branch on origin
        `refs/heads/${ref}`,   // As local branch
        `refs/remotes/origin/${ref}` // As remote branch
      ];
      
      // Remove duplicates (in case ref already starts with 'v')
      const uniquePatterns = [...new Set(refPatterns)];
      
      for (const pattern of uniquePatterns) {
        try {
          const result = await executeCommand('git', ['rev-parse', '--verify', pattern], tempDir);
          return { ref: pattern, hash: result.trim() };
        } catch (error) {
          // Continue to next pattern
          continue;
        }
      }
      
      // If no direct reference found, return null
      return null;
    };
    
    // Find commit with version bump
    const findVersionCommit = async (version) => {
      try {
        // Look for version in commit messages (common patterns)
        const patterns = [
          `version bump to ${version}`,
          `bump version to ${version}`,
          `version ${version}`,
          `v${version}`,
          `${version} release`,
          `release ${version}`
        ];
        
        // Search for commits with version in message
        for (const pattern of patterns) {
          try {
            const result = await executeCommand(
              'git',
              ['log', '--grep', pattern, '--format=%H', '-n', '1'],
              tempDir
            );
            
            if (result.trim()) {
              return { ref: version, hash: result.trim() };
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
        
        // Look for version in package.json changes
        try {
          const result = await executeCommand(
            'git',
            ['log', '-p', '--all', '-G', `"version":\\s*"${version}"`, '--format=%H', '-n', '1'],
            tempDir
          );
          
          if (result.trim()) {
            return { ref: version, hash: result.trim() };
          }
        } catch (e) {
          // Continue to next approach
        }
        
        return null;
      } catch (error) {
        return null;
      }
    };
    
    // Resolve references
    let resolvedOldRef = await checkRef(oldRef);
    let resolvedNewRef = await checkRef(newRef);
    
    // If direct references not found, try to find commits with version bumps
    if (!resolvedOldRef) {
      resolvedOldRef = await findVersionCommit(oldVersion);
    }
    
    if (!resolvedNewRef) {
      resolvedNewRef = await findVersionCommit(newVersion);
    }
    
    // If still no references found, try to get all tags and find closest matches
    if (!resolvedOldRef || !resolvedNewRef) {
      try {
        const tagsOutput = await executeCommand('git', ['tag', '-l'], tempDir);
        const availableTags = tagsOutput.split('\n').filter(tag => tag.trim());
        
        if (!resolvedOldRef) {
          // Try to find a tag that contains the old version
          const oldMatch = availableTags.find(tag => 
            tag.includes(oldVersion) || 
            tag.replace(/^v/, '') === oldVersion ||
            tag === `v${oldVersion}`
          );
          if (oldMatch) {
            try {
              const result = await executeCommand('git', ['rev-parse', '--verify', oldMatch], tempDir);
              resolvedOldRef = { ref: oldMatch, hash: result.trim() };
            } catch (e) {
              // Continue to fallback
            }
          }
        }
        
        if (!resolvedNewRef) {
          // Try to find a tag that contains the new version
          const newMatch = availableTags.find(tag => 
            tag.includes(newVersion) || 
            tag.replace(/^v/, '') === newVersion ||
            tag === `v${newVersion}`
          );
          if (newMatch) {
            try {
              const result = await executeCommand('git', ['rev-parse', '--verify', newMatch], tempDir);
              resolvedNewRef = { ref: newMatch, hash: result.trim() };
            } catch (e) {
              // Continue to fallback
            }
          }
        }
      } catch (error) {
        // Continue to fallback
      }
    }
    
    // Last resort: if we can't find specific versions, use default branch for newer and first commit for older
    if (!resolvedOldRef && !resolvedNewRef) {
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
        
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
      } catch (error) {
        return [];
      }
    } else if (!resolvedOldRef) {
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
      } catch (error) {
        return [];
      }
    } else if (!resolvedNewRef) {
      try {
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
      } catch (error) {
        return [];
      }
    }
    
    // Check if the order is correct (older should come before newer)
    try {
      // Try to determine which commit came first
      const mergeBase = await executeCommand(
        'git',
        ['merge-base', resolvedOldRef.hash, resolvedNewRef.hash],
        tempDir
      );
      
      // If merge-base equals oldRef, order is correct
      // If merge-base equals newRef, order is reversed
      // If merge-base is different from both, they're on different branches
      
      if (mergeBase.trim() === resolvedNewRef.hash.trim()) {
        // Order is reversed, swap them
        const temp = resolvedOldRef;
        resolvedOldRef = resolvedNewRef;
        resolvedNewRef = temp;
      }
    } catch (error) {
      // Continue with original order
    }
    
    let output;
    try {
      output = await executeCommand(
        'git', 
        ['log', `${resolvedOldRef.hash}..${resolvedNewRef.hash}`, '--pretty=format:%H,%an,%ad,%s'], 
        tempDir
      );
    } catch (error) {
      // Try with a different approach - get all commits and filter
      try {
        output = await executeCommand(
          'git',
          ['log', '--pretty=format:%H,%an,%ad,%s'],
          tempDir
        );
      } catch (e) {
        return [];
      }
    }
    
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
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      unregisterTempDir(tempDir);
    }
    
    return commits;
  } catch (error) {
    // Clean up on error
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        unregisterTempDir(tempDir);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    return [];
  }
};

/**
 * Check if package-lock.json exists and get dependency changes from it
 * @param {string} olderVersionDir - Directory of older version
 * @param {string} newerVersionDir - Directory of newer version
 * @returns {Promise<Object>} - Object with changed packages and their version info
 */
const getPackageLockChanges = async (olderVersionDir, newerVersionDir) => {
  try {
    const oldLockPath = join(olderVersionDir, 'package-lock.json');
    const newLockPath = join(newerVersionDir, 'package-lock.json');
    
    // Check if both files exist
    try {
      await readFile(oldLockPath);
      await readFile(newLockPath);
    } catch (error) {
      return { changedPackages: [], packageVersions: {} };
    }
    
    // Read and parse both lock files
    const oldLock = JSON.parse(await readFile(oldLockPath, 'utf8'));
    const newLock = JSON.parse(await readFile(newLockPath, 'utf8'));
    
    // Extract all packages from lock files
    const oldPackages = extractPackagesFromLock(oldLock);
    const newPackages = extractPackagesFromLock(newLock);
    
    // Find packages that changed, were added, or were removed
    const changedPackages = new Set();
    const packageVersions = {};
    
    // Check for added and changed packages
    for (const [name, newInfo] of Object.entries(newPackages)) {
      if (!oldPackages[name]) {
        // Package was added
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: null,
          newVersion: newInfo.version,
          changeType: 'added'
        };
      } else if (oldPackages[name].version !== newInfo.version) {
        // Package version changed
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: oldPackages[name].version,
          newVersion: newInfo.version,
          changeType: 'upgraded'
        };
      }
    }
    
    // Check for removed packages
    for (const [name, oldInfo] of Object.entries(oldPackages)) {
      if (!newPackages[name]) {
        // Package was removed
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: oldInfo.version,
          newVersion: null,
          changeType: 'removed'
        };
      }
    }
    
    return { 
      changedPackages: Array.from(changedPackages), 
      packageVersions 
    };
    
  } catch (error) {
    return { changedPackages: [], packageVersions: {} };
  }
};

/**
 * Extract all packages from a package-lock.json structure
 * @param {Object} lockData - Parsed package-lock.json data
 * @returns {Object} - Map of package names to their info
 */
const extractPackagesFromLock = (lockData) => {
  const packages = {};
  
  // Handle both lockfileVersion 1 and 2+ formats
  if (lockData.lockfileVersion >= 2 && lockData.packages) {
    // Version 2+ format uses "packages" field
    for (const [path, info] of Object.entries(lockData.packages)) {
      if (path === '') continue; // Skip root package
      
      // Extract package name from path (remove node_modules prefix)
      const name = path.replace(/^node_modules\//, '');
      if (info.version) {
        packages[name] = {
          version: info.version,
          resolved: info.resolved,
          integrity: info.integrity
        };
      }
    }
  } else if (lockData.dependencies) {
    // Version 1 format uses "dependencies" field
    extractFromDependencies(lockData.dependencies, packages);
  }
  
  return packages;
};

/**
 * Recursively extract packages from dependencies object (lockfile v1 format)
 * @param {Object} dependencies - Dependencies object
 * @param {Object} packages - Accumulator for packages
 */
const extractFromDependencies = (dependencies, packages) => {
  for (const [name, info] of Object.entries(dependencies)) {
    if (info.version) {
      packages[name] = {
        version: info.version,
        resolved: info.resolved,
        integrity: info.integrity
      };
    }
    
    // Recursively process nested dependencies
    if (info.dependencies) {
      extractFromDependencies(info.dependencies, packages);
    }
  }
};

/**
 * Process a single dependency for changelog and CI status with progress updates
 * @param {Object} dep - Dependency object
 * @param {string} newerVersionDir - Directory of the newer version
 * @param {string} reposDir - Repository directory
 * @param {Object} multibar - CLI multi progress bar instance
 * @param {number} maxNameLength - Maximum name length for consistent padding
 * @returns {Promise<Object>} - Object with changelog, error, and CI status
 */
const processSingleDependency = async (dep, newerVersionDir, reposDir, multibar, maxNameLength) => {
  const result = {
    name: dep.name,
    changelog: null,
    error: null,
    ciStatus: null
  };
  
  // Format the name with consistent padding, truncating if necessary
  let displayName = dep.name;
  if (displayName.length > maxNameLength) {
    displayName = displayName.substring(0, maxNameLength - 3) + '...';
  }
  displayName = displayName.padEnd(maxNameLength);
  
  // Create individual progress bar for this dependency
  const depBar = multibar.create(100, 0, { name: displayName, status: 'Starting...' });
  
  depBar.update(10, { status: 'Getting repo URL...' });
  const packageDir = join(newerVersionDir, 'node_modules', dep.name);
  const repoUrl = await getRepositoryUrl(packageDir);
  
  if (!repoUrl) {
    depBar.update(100, { status: '❌ No repo URL' });
    result.error = {
      repoUrl: null,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      error: "No repository URL found"
    };
    return result;
  }
  
  depBar.update(20, { status: 'Cleaning repo URL...' });
  
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
  // Handle git:// protocol URLs
  else if (cleanRepoUrl.match(/^git:\/\/github\.com\//)) {
    cleanRepoUrl = `git@github.com:${cleanRepoUrl.replace(/^git:\/\/github\.com\//, '')}`;
  }
  // Ensure URL is in the correct format for GitHub
  else if (!cleanRepoUrl.match(/^git@github\.com:/)) {
    // If it's not already in the git@github.com format, try to convert it
    const parts = cleanRepoUrl.split('/');
    const repoName = parts.pop();
    const orgName = parts.pop();
    if (orgName && repoName) {
      cleanRepoUrl = `git@github.com:${orgName}/${repoName}`;
    }
  }
  
  // Add .git extension if not present
  if (!cleanRepoUrl.endsWith('.git')) {
    cleanRepoUrl += '.git';
  }
  
  depBar.update(30, { status: 'Getting commits...' });
  
  let commits = [];
  try {
    commits = await getCommitHistory(cleanRepoUrl, dep.oldVersion, dep.newVersion, reposDir);
    if (commits.length > 0) {
      depBar.update(70, { status: `Found ${commits.length} commits` });
      result.changelog = {
        repoUrl: cleanRepoUrl,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        commits
      };
    } else {
      depBar.update(70, { status: '⚠️ No commits found' });
      result.error = {
        repoUrl: cleanRepoUrl,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        error: "No commits found between versions"
      };
    }
  } catch (error) {
    depBar.update(70, { status: '❌ Commit error' });
    result.error = {
      repoUrl: cleanRepoUrl,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      error: error.message
    };
  }
  
  // Get GitHub Actions status for the new version
  depBar.update(80, { status: 'Getting CI status...' });
  try {
    const best = commits.length > 0 ? commits[0].hash : null;
    const actionsStatus = await getGitHubActionsStatus(cleanRepoUrl, dep.newVersion, best);
    if (actionsStatus) {
      result.ciStatus = actionsStatus;
      depBar.update(100, { status: `✅ Complete (CI: ${actionsStatus.status})` });
    } else {
      depBar.update(100, { status: '✅ Complete (no CI)' });
    }
  } catch (error) {
    // Silently ignore CI status errors
    depBar.update(100, { status: '✅ Complete (CI error)' });
  }
  
  return result;
};

/**
 * Process dependencies in parallel with concurrency limit using a proper queue
 * @param {Array} dependencies - Array of dependencies to process
 * @param {string} newerVersionDir - Directory of the newer version
 * @param {string} reposDir - Repository directory
 * @param {number} concurrency - Maximum number of concurrent operations
 * @returns {Promise<Object>} - Object with changelogs, errors, and CI status
 */
const processInParallel = async (dependencies, newerVersionDir, reposDir, concurrency = 5) => {
  const changelogs = {};
  const errors = {};
  const ciStatus = {};
  
  if (dependencies.length === 0) {
    return { changelogs, errors, ciStatus };
  }
  
  // Calculate the maximum name length for consistent padding
  const maxNameLength = Math.min(
    Math.max(...dependencies.map(dep => dep.name.length)),
    40 // Reasonable maximum to prevent extremely long lines
  );
  
  // Create multi progress bar
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '{name} |{bar}| {percentage}% | {status}'
  }, {
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591'
  });
  
  // Register multibar for cleanup
  globalCleanupState.multibar = multibar;
  
  console.log(`\nProcessing ${dependencies.length} dependencies with concurrency limit of ${concurrency}:\n`);
  
  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency });
  
  // Add all dependencies to the queue
  const promises = dependencies.map(dep => 
    queue.add(() => processSingleDependency(dep, newerVersionDir, reposDir, multibar, maxNameLength))
  );
  
  // Wait for all tasks to complete
  const results = await Promise.all(promises);
  
  // Collect results
  for (const result of results) {
    if (result.changelog) {
      changelogs[result.name] = result.changelog;
    }
    if (result.error) {
      errors[result.name] = result.error;
    }
    if (result.ciStatus) {
      ciStatus[result.name] = result.ciStatus;
    }
  }
  
  multibar.stop();
  
  // Unregister multibar from cleanup
  globalCleanupState.multibar = null;
  
  // Ensure cursor is visible after progress bars
  process.stdout.write('\x1b[?25h'); // Show cursor
  
  console.log(`\n✅ Completed processing ${dependencies.length} dependencies\n`);
  
  return { changelogs, errors, ciStatus };
};

/**
 * Get changelog and CI status for upgraded dependencies
 * @param {Array} upgradedDeps - Array of upgraded dependencies
 * @param {string} newerVersionDir - Directory of the newer version
 * @param {string} reposDir - Repository directory
 * @returns {Promise<Object>} - Object mapping package names to changelogs and CI status
 */
const getChangelogs = async (upgradedDeps, newerVersionDir, reposDir) => {
  return await processInParallel(upgradedDeps, newerVersionDir, reposDir, 5);
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
  const modified = [];

  // Track packages that might have changed namespaces
  const potentialNamespaceChanges = new Map();
  
  // Helper function to get the base name without namespace
  const getBaseName = (name) => {
    return name.includes('/') ? name.split('/').pop() : name;
  };
  
  // Helper function to check if a name is namespaced
  const isNamespaced = (name) => name.includes('/');

  // First pass: Find added and upgraded dependencies
  for (const [name, info] of Object.entries(newDeps)) {
    if (!oldDeps[name]) {
      // Store potentially renamed packages for later processing
      const baseName = getBaseName(name);
      potentialNamespaceChanges.set(baseName, {
        newName: name,
        newVersion: info.version,
        repository: info.repository || null,
        type: 'added'
      });
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
        // Silently continue with unknown change type
      }

      upgraded.push({
        name,
        oldVersion,
        newVersion,
        changeType,
        repository: info.repository || null
      });
    }
  }

  // Second pass: Find removed dependencies and check for namespace changes
  for (const [name, info] of Object.entries(oldDeps)) {
    if (!newDeps[name]) {
      const baseName = getBaseName(name);
      
      // Check if this might be a namespace change
      if (potentialNamespaceChanges.has(baseName)) {
        const match = potentialNamespaceChanges.get(baseName);
        
        // This is likely a namespace change (e.g., pkg -> @org/pkg or vice versa)
        modified.push({
          oldName: name,
          newName: match.newName,
          oldVersion: info.version,
          newVersion: match.newVersion,
          changeType: 'namespace'
        });
        
        // Remove from potential namespace changes to avoid double-counting
        potentialNamespaceChanges.delete(baseName);
      } else {
        // Store potentially renamed packages for later processing
        potentialNamespaceChanges.set(baseName, {
          oldName: name,
          oldVersion: info.version,
          type: 'removed'
        });
      }
    }
  }
  
  // Process remaining potential namespace changes
  for (const [baseName, data] of potentialNamespaceChanges.entries()) {
    if (data.type === 'added') {
      added.push({ 
        name: data.newName, 
        version: data.newVersion,
        repository: data.repository 
      });
    } else if (data.type === 'removed') {
      removed.push({ name: data.oldName, version: data.oldVersion });
    }
  }

  // Compare nested dependencies if they exist
  const nestedAdded = [];
  const nestedRemoved = [];
  const nestedUpgraded = [];
  const nestedModified = [];
  
  // Helper function to process nested dependencies
  const processNestedDependencies = (oldParent, newParent, parentName) => {
    if (!oldParent || !newParent) return;
    
    const oldNestedDeps = oldParent.dependencies || {};
    const newNestedDeps = newParent.dependencies || {};
    
    // Compare nested dependencies
    for (const [name, info] of Object.entries(newNestedDeps)) {
      if (!oldNestedDeps[name]) {
        nestedAdded.push({ 
          name, 
          version: info.version,
          repository: info.repository,
          parent: parentName
        });
      } else if (oldNestedDeps[name].version !== info.version) {
        const oldVersion = oldNestedDeps[name].version;
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
          // Silently continue with unknown change type
        }

        nestedUpgraded.push({
          name,
          oldVersion,
          newVersion,
          changeType,
          repository: info.repository,
          parent: parentName
        });
      }
    }
    
    // Find removed nested dependencies
    for (const [name, info] of Object.entries(oldNestedDeps)) {
      if (!newNestedDeps[name]) {
        nestedRemoved.push({ 
          name, 
          version: info.version,
          parent: parentName
        });
      }
    }
  };
  
  // Process nested dependencies for each top-level dependency
  for (const [name, info] of Object.entries(newDeps)) {
    if (oldDeps[name] && info.dependencies) {
      processNestedDependencies(oldDeps[name], info, name);
    }
  }
  
  return { 
    added, 
    removed, 
    upgraded, 
    modified,
    nested: {
      added: nestedAdded,
      removed: nestedRemoved,
      upgraded: nestedUpgraded,
      modified: nestedModified
    }
  };
};

/**
 * Main function to analyze dependency changes between two versions
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref1 - First git reference
 * @param {string} ref2 - Second git reference
 * @param {string} workingDir - Working directory (optional)
 * @param {string} namespace - Optional namespace to filter second-level dependencies (e.g., @holepunch)
 * @returns {Promise<Object>} - Analysis report
 */
const analyzeDependencyChanges = async (repoUrl, olderVersion, newerVersion, workingDir = process.cwd(), namespace = null) => {
  // Setup signal handlers for graceful shutdown
  setupSignalHandlers();
  
  // Extract project name from repo URL
  const projectName = basename(repoUrl, '.git');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reposDir = join(workingDir, `${projectName}-${timestamp}`);
  
  const olderVersionDir = join(reposDir, `${olderVersion}`);
  const newerVersionDir = join(reposDir, `${newerVersion}`);
  
  try {
    // Create the repos directory
    await mkdir(reposDir, { recursive: true });
    
    // Register temp directory for cleanup
    registerTempDir(reposDir);
    
    // Clone both versions
    await cloneRepo(repoUrl, olderVersion, olderVersionDir);
    await cloneRepo(repoUrl, newerVersion, newerVersionDir);
    
    // Install dependencies for both versions
    await installDependencies(olderVersionDir);
    await installDependencies(newerVersionDir);
    
    // Get dependencies for both versions, with namespace filtering for second-level dependencies if specified
    const olderDeps = await getDependencies(olderVersionDir, namespace);
    const newerDeps = await getDependencies(newerVersionDir, namespace);
    
    // Compare dependencies
    const comparison = compareDependencies(olderDeps, newerDeps);
    
    // Get package changes from package-lock.json if available
    const { changedPackages: lockFileChanges, packageVersions } = await getPackageLockChanges(olderVersionDir, newerVersionDir);
    
    // Create a combined list of packages to get changelogs for
    let allChangedPackages = [...comparison.upgraded];
    
    // Add any packages from lock file that aren't already in our list
    for (const packageName of lockFileChanges) {
      if (!comparison.upgraded.some(dep => dep.name === packageName)) {
        const versionInfo = packageVersions[packageName];
        
        // Only process upgraded packages for changelog generation
        if (versionInfo.changeType === 'upgraded') {
          try {
            const packageDir = join(newerVersionDir, 'node_modules', packageName);
            const packageJsonPath = join(packageDir, 'package.json');
            
            let repoUrl = null;
            
            try {
              const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
              
              // Extract repository URL
              if (packageJson.repository) {
                if (typeof packageJson.repository === 'string') {
                  repoUrl = packageJson.repository;
                } else if (packageJson.repository.url) {
                  repoUrl = packageJson.repository.url;
                }
              }
            } catch (e) {
              // Silently skip packages we can't read
            }
            
            if (repoUrl) {
              // Determine change type using semver if possible
              let changeType = 'unknown';
              try {
                const oldVersion = versionInfo.oldVersion;
                const newVersion = versionInfo.newVersion;
                
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
                console.warn(`Warning: Could not determine semver change type for ${packageName}: ${error.message}`);
              }
              
              // Create the dependency object
              const lockFileDep = {
                name: packageName,
                oldVersion: versionInfo.oldVersion,
                newVersion: versionInfo.newVersion,
                repository: repoUrl,
                changeType: changeType
              };
              
              // Add to the list for changelog generation
              allChangedPackages.push(lockFileDep);
              
              // Also add to the comparison.upgraded array so it appears in the report
              comparison.upgraded.push(lockFileDep);
              
              // Added package from lock file analysis
            }
          } catch (error) {
            // Silently skip packages we can't get info for
          }
        }
      }
    }
    
    // Get changelogs for upgraded dependencies
    console.log(`\nGenerating changelogs for ${allChangedPackages.length} dependencies...`);
    const { changelogs, errors, ciStatus } = await getChangelogs(allChangedPackages, newerVersionDir, reposDir);
  
    // Get changelogs for modified dependencies (namespace changes)
    if (comparison.modified.length > 0) {
      console.log(`Generating changelogs for ${comparison.modified.length} modified dependencies...`);
      const modifiedDepsForChangelog = comparison.modified.map(dep => ({
        name: dep.newName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        changeType: 'namespace'
      }));
      const { changelogs: modifiedChangelogs, errors: modifiedErrors, ciStatus: modifiedCiStatus } = 
        await getChangelogs(modifiedDepsForChangelog, newerVersionDir, reposDir);
    
      // Merge changelogs, errors, and CI status
      Object.assign(changelogs, modifiedChangelogs);
      Object.assign(errors, modifiedErrors);
      Object.assign(ciStatus, modifiedCiStatus);
    }
    
    // Get changelogs for nested upgraded dependencies
    if (comparison.nested.upgraded.length > 0) {
      console.log(`Generating changelogs for ${comparison.nested.upgraded.length} nested upgraded dependencies...`);
      const { changelogs: nestedChangelogs, errors: nestedErrors, ciStatus: nestedCiStatus } = 
        await getChangelogs(comparison.nested.upgraded, newerVersionDir, reposDir);
      
      // Merge nested changelogs, errors, and CI status
      Object.assign(changelogs, nestedChangelogs);
      Object.assign(errors, nestedErrors);
      Object.assign(ciStatus, nestedCiStatus);
    }
    
    // Write report to file
    const reportPath = join(reposDir, 'report.json');
    
    // Create report (without reportPath initially)
    const report = {
      repository: repoUrl,
      olderVersion: olderVersion,
      newerVersion: newerVersion,
      timestamp: new Date().toISOString(),
      changes: comparison,
      changelogs,
      errors,
      ciStatus,
      namespace: namespace || null
    };
    
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Add reportPath after writing the file
    report.reportPath = reportPath;
    
    console.log(`\n📊 Report generated: ${reportPath}`);
    
    // Don't auto-cleanup on success - user might want to examine the files
    // But unregister from emergency cleanup since we completed successfully
    unregisterTempDir(reposDir);
    
    return report;
  } catch (error) {
    console.error(`\n❌ Error analyzing dependency changes: ${error.message}`);
    
    // Clean up on error
    try {
      await rm(reposDir, { recursive: true, force: true });
      unregisterTempDir(reposDir);
      console.log(`🗑️  Cleaned up temporary directory: ${reposDir}`);
    } catch (cleanupError) {
      console.warn(`⚠️  Failed to clean up ${reposDir}: ${cleanupError.message}`);
    }
    
    throw error;
  }
};

export { analyzeDependencyChanges };
