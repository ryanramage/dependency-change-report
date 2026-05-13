import { join, basename } from 'path';
import { mkdir, writeFile, readFile, rm, readdir } from 'fs/promises';
import semver from 'semver';
import PQueue from 'p-queue';

// Import utilities
import { setupSignalHandlers, registerTempDir, unregisterTempDir } from '../utils/cleanup-manager.mjs';
import { createMultiProgressBar, stopMultiProgressBar, shouldUseProgressBars } from '../utils/progress-manager.mjs';

// Import external services
import { executeCommand, time_2min, time_1min } from '../utils/command-executor.mjs';
import { getGitHubActionsStatus } from '../external/github-api.mjs';
import { installDependencies, getDependencies } from '../npm/dependencies.mjs';
import { getRepositoryUrl, cleanRepositoryUrl } from '../npm/package-info.mjs';

// Import core logic
import { getPackageLockChanges, getDevDependencies } from './package-lock-parser.mjs';
import { compareDependencies } from './dependency-comparer.mjs';
import { getDcrIgnoreList, shouldIgnorePackage } from '../utils/dprignore-parser.mjs';

/**
 * Process a single dependency for changelog and CI status with progress updates
 * @param {Object} dep - Dependency object
 * @param {string} newerVersionDir - Directory of the newer version
 * @param {string} reposDir - Repository directory
 * @param {Object} multibar - CLI multi progress bar instance (null if disabled)
 * @param {number} maxNameLength - Maximum name length for consistent padding
 * @param {boolean} useProgressBars - Whether to use progress bars
 * @returns {Promise<Object>} - Object with changelog, error, and CI status
 */
const processSingleDependency = async (dep, newerVersionDir, reposDir, multibar, maxNameLength, useProgressBars = true) => {
  // Add a small delay in CI environments to avoid overwhelming GitHub
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  if (isCI) {
    const delay = Math.random() * 2000; // Random delay 0-2 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
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
  
  // Create individual progress bar for this dependency (if enabled)
  let depBar = null;
  if (useProgressBars && multibar) {
    depBar = multibar.create(100, 0, { name: displayName, status: 'Starting...' });
    depBar.update(10, { status: 'Getting repo URL...' });
  } else if (!useProgressBars) {
    console.log(`Processing ${dep.name}...`);
  }
  const packageDir = join(newerVersionDir, 'node_modules', dep.name);
  const repoUrl = await getRepositoryUrl(packageDir);
  
  if (!repoUrl) {
    if (depBar) {
      depBar.update(100, { status: '❌ No repo URL' });
    } else if (!useProgressBars) {
      console.log(`  ❌ ${dep.name}: No repository URL found`);
    }
    result.error = {
      repoUrl: null,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      error: "No repository URL found"
    };
    return result;
  }
  
  if (depBar) {
    depBar.update(20, { status: 'Cleaning repo URL...' });
  }
  
  // Clean the repository URL and convert to git URL for authentication
  const cleanRepoUrl = cleanRepositoryUrl(repoUrl);
  
  if (depBar) {
    depBar.update(30, { status: 'Getting commits...' });
  }
  
  let commits = [];
  try {
    const { getCommitHistory } = await import('../git/repository.mjs');
    commits = await getCommitHistory(cleanRepoUrl, dep.oldVersion, dep.newVersion, reposDir);
    if (commits.length > 0) {
      if (depBar) {
        depBar.update(70, { status: `Found ${commits.length} commits` });
      } else if (!useProgressBars) {
        console.log(`  ✅ ${dep.name}: Found ${commits.length} commits`);
      }
      result.changelog = {
        repoUrl: cleanRepoUrl,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        commits
      };
    } else {
      if (depBar) {
        depBar.update(70, { status: '⚠️ No commits found' });
      } else if (!useProgressBars) {
        console.log(`  ⚠️ ${dep.name}: No commits found between versions`);
      }
      result.error = {
        repoUrl: cleanRepoUrl,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        error: `No commits found between versions ${dep.oldVersion} -> ${dep.newVersion}`
      };
    }
  } catch (error) {
    // Categorize the error for better debugging
    let errorCategory = 'unknown';
    let errorMessage = error.message;
    
    if (error.message.includes('Authentication failed') || error.message.includes('Permission denied')) {
      errorCategory = 'auth';
      errorMessage = 'Authentication failed - repository may be private or require different credentials';
    } else if (error.message.includes('Network is unreachable') || error.message.includes('Temporary failure')) {
      errorCategory = 'network';
      errorMessage = 'Network error - GitHub may be rate limiting or temporarily unavailable';
    } else if (error.message.includes('Repository not found') || error.message.includes('does not exist')) {
      errorCategory = 'not_found';
      errorMessage = 'Repository not found or may have been moved/deleted';
    } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
      errorCategory = 'timeout';
      errorMessage = 'Operation timed out - repository may be too large or network is slow';
    }
    
    if (depBar) {
      depBar.update(70, { status: `❌ ${errorCategory}` });
    } else if (!useProgressBars) {
      console.log(`  ❌ ${dep.name}: ${errorCategory} - ${errorMessage}`);
    }
    
    result.error = {
      repoUrl: cleanRepoUrl,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      error: errorMessage,
      category: errorCategory
    };
  }
  
  // Get GitHub Actions status for the new version
  if (depBar) {
    depBar.update(80, { status: 'Getting CI status...' });
  }
  try {
    const best = commits.length > 0 ? commits[0].hash : null;
    const actionsStatus = await getGitHubActionsStatus(cleanRepoUrl, dep.newVersion, best);
    if (actionsStatus) {
      result.ciStatus = actionsStatus;
      if (depBar) {
        depBar.update(90, { status: `CI: ${actionsStatus.status}` });
      } else if (!useProgressBars) {
        console.log(`  ✅ ${dep.name}: Complete (CI: ${actionsStatus.status})`);
      }
    } else {
      if (depBar) {
        depBar.update(90, { status: 'No CI found' });
      } else if (!useProgressBars) {
        console.log(`  ✅ ${dep.name}: Complete (no CI)`);
      }
    }
  } catch (error) {
    // Silently ignore CI status errors
    if (depBar) {
      depBar.update(90, { status: 'CI check failed' });
    } else if (!useProgressBars) {
      console.log(`  ✅ ${dep.name}: Complete (CI error)`);
    }
  }
  
  // Final completion status
  if (depBar) {
    depBar.update(100, { status: '✅ Complete' });
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
  // Reduce concurrency in CI environments to avoid rate limiting
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  if (isCI) {
    concurrency = Math.min(concurrency, 1); // Limit to 1 concurrent operation in CI for maximum reliability
    console.log(`Running in CI environment, reducing concurrency to ${concurrency} and adding delays`);
  }
  
  const changelogs = {};
  const errors = {};
  const ciStatus = {};
  
  if (dependencies.length === 0) {
    return { changelogs, errors, ciStatus };
  }
  
  // Check if we should use progress bars
  const useProgressBars = shouldUseProgressBars(dependencies.length);
  
  // Calculate the maximum name length for consistent padding
  const maxNameLength = Math.min(
    Math.max(...dependencies.map(dep => dep.name.length)),
    40 // Reasonable maximum to prevent extremely long lines
  );
  
  // Create progress bar if appropriate
  const multibar = createMultiProgressBar(dependencies.length);
  
  // Create queue with concurrency limit
  const queue = new PQueue({ concurrency });
  
  // Add all dependencies to the queue
  const promises = dependencies.map(dep => 
    queue.add(() => processSingleDependency(dep, newerVersionDir, reposDir, multibar, maxNameLength, useProgressBars))
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
  
  // Stop progress bars
  stopMultiProgressBar(multibar);
  
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
 * Process a single package during node_modules scanning
 * @param {string} baseDir - Base directory
 * @param {string} packageName - Package name
 * @param {string} packagePath - Relative path to package
 * @param {boolean} isTopLevel - Whether this is a top-level package
 * @param {Map} packages - Map to store package info
 * @returns {Promise<void>}
 */
const processPackage = async (baseDir, packageName, packagePath, isTopLevel, packages) => {
  try {
    const packageJsonPath = join(baseDir, packagePath, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const version = packageJson.version || 'unknown';
    
    if (!packages.has(packageName)) {
      packages.set(packageName, []);
    }
    
    packages.get(packageName).push({
      version,
      level: isTopLevel ? 'top-level' : 'nested',
      path: packagePath
    });
    
    // Recursively scan this package's node_modules
    const nestedPackages = await scanNodeModulesRecursive(baseDir, packagePath);
    for (const [nestedName, nestedInfos] of nestedPackages) {
      if (!packages.has(nestedName)) {
        packages.set(nestedName, []);
      }
      packages.get(nestedName).push(...nestedInfos);
    }
  } catch (error) {
    // Can't read package.json, skip this package
  }
};

/**
 * Recursively scan node_modules directory and collect all packages
 * @param {string} baseDir - Base directory containing node_modules
 * @param {string} currentPath - Current path being scanned (for recursion)
 * @returns {Promise<Map>} - Map of package name to array of {version, level, path}
 */
const scanNodeModulesRecursive = async (baseDir, currentPath = '') => {
  const packages = new Map();
  const nodeModulesPath = join(baseDir, currentPath, 'node_modules');
  
  try {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      // Skip .bin and other special directories
      if (entry.name.startsWith('.')) continue;
      
      // Handle scoped packages (@scope/package)
      if (entry.name.startsWith('@')) {
        const scopePath = join(nodeModulesPath, entry.name);
        try {
          const scopedEntries = await readdir(scopePath, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            if (!scopedEntry.isDirectory()) continue;
            
            const packageName = `${entry.name}/${scopedEntry.name}`;
            const packagePath = join(currentPath, 'node_modules', entry.name, scopedEntry.name);
            await processPackage(baseDir, packageName, packagePath, currentPath === '', packages);
          }
        } catch (error) {
          // Can't read scoped directory, skip
        }
      } else {
        const packageName = entry.name;
        const packagePath = join(currentPath, 'node_modules', entry.name);
        await processPackage(baseDir, packageName, packagePath, currentPath === '', packages);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return packages;
};

/**
 * Build installed snapshot from a scanned packages Map
 * @param {Map} packages - Map of package name to array of {version, level, path}
 * @returns {Object} - Object keyed by package name with topLevelVersion and allVersions
 */
const buildInstalledSnapshot = (packages) => {
  const snapshot = {};
  for (const [name, infos] of packages) {
    const topLevelInfo = infos.find(i => i.level === 'top-level');
    const allVersions = [...new Set(infos.map(i => i.version))].sort();
    snapshot[name] = {
      topLevelVersion: topLevelInfo ? topLevelInfo.version : null,
      allVersions
    };
  }
  return snapshot;
};

/**
 * Build inventory table from old and new package maps
 * @param {Map} oldPackages - Map of packages from old version
 * @param {Map} newPackages - Map of packages from new version
 * @returns {Array} - Array of inventory entries
 */
const buildInventoryTable = (oldPackages, newPackages) => {
  const allPackageNames = new Set([...oldPackages.keys(), ...newPackages.keys()]);
  const inventory = [];
  
  for (const name of allPackageNames) {
    const oldInfos = oldPackages.get(name) || [];
    const newInfos = newPackages.get(name) || [];
    
    // Dedupe and detect conflicts
    const oldVersions = [...new Set(oldInfos.map(i => i.version))];
    const newVersions = [...new Set(newInfos.map(i => i.version))];
    
    const oldLevel = oldInfos.length > 0 ? 
      (oldInfos.some(i => i.level === 'top-level') ? 'top-level' : 'nested') : null;
    const newLevel = newInfos.length > 0 ? 
      (newInfos.some(i => i.level === 'top-level') ? 'top-level' : 'nested') : null;
    
    inventory.push({
      name,
      oldVersion: oldVersions.length > 0 ? oldVersions.join(', ') : null,
      newVersion: newVersions.length > 0 ? newVersions.join(', ') : null,
      oldLevel,
      newLevel,
      hasOldConflict: oldVersions.length > 1,
      hasNewConflict: newVersions.length > 1
    });
  }
  
  // Sort case-insensitive by full name
  inventory.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  
  return inventory;
};

/**
 * Collect all dev dependencies and their nested dependencies
 * @param {string} versionDir - Directory containing package.json and node_modules
 * @returns {Promise<Set>} - Set of all dev dependency names (including nested)
 */
const collectAllDevDependencies = async (versionDir) => {
  const allDevDeps = new Set();
  
  try {
    // Get top-level dev dependencies from package.json
    const topLevelDevDeps = await getDevDependencies(versionDir);
    
    // Add all top-level dev dependencies to the set
    for (const devDep of topLevelDevDeps) {
      allDevDeps.add(devDep);
    }
    
    // For each top-level dev dependency, recursively collect all nested dependencies
    const collectNestedDeps = async (packageName, visited = new Set()) => {
      if (visited.has(packageName)) {
        return; // Avoid circular dependencies
      }
      visited.add(packageName);
      
      try {
        const packageDir = join(versionDir, 'node_modules', packageName);
        const packageJsonPath = join(packageDir, 'package.json');
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
        
        // Add all dependencies of this dev dependency
        if (packageJson.dependencies) {
          for (const depName of Object.keys(packageJson.dependencies)) {
            allDevDeps.add(depName);
            // Recursively collect nested dependencies
            await collectNestedDeps(depName, visited);
          }
        }
      } catch (error) {
        // Silently skip packages we can't read
      }
    };
    
    // Collect nested dependencies for each top-level dev dependency
    for (const devDep of topLevelDevDeps) {
      await collectNestedDeps(devDep);
    }
    
  } catch (error) {
    // If we can't read dev dependencies, return empty set
  }
  
  return allDevDeps;
};

/**
 * Clean up stale git worktrees
 * @returns {Promise<void>}
 */
const cleanupStaleWorktrees = async () => {
  console.log('🧹 Cleaning up stale worktrees...');
  try {
    // First, prune worktrees that no longer exist
    await executeCommand('git', ['worktree', 'prune'], process.cwd(), time_1min, 'pruning stale worktrees', false);
    
    // List all worktrees to see what's left
    const worktreeList = await executeCommand('git', ['worktree', 'list', '--porcelain'], process.cwd(), time_1min, 'listing worktrees', false);
    
    // Parse the worktree list to find any in temp directories
    const lines = worktreeList.split('\n');
    const worktreesToRemove = [];
    let currentWorktree = null;
    
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktree = line.substring(9); // Remove 'worktree ' prefix
      } else if (line.startsWith('branch ') && currentWorktree) {
        const branch = line.substring(7); // Remove 'branch ' prefix
        // Check if this worktree is in a temp directory
        if (currentWorktree.includes('/dependency-change-report-nodejs/') || 
            currentWorktree.includes('\\dependency-change-report-nodejs\\')) {
          worktreesToRemove.push({ path: currentWorktree, branch });
        }
        currentWorktree = null;
      }
    }
    
    // Remove any temp worktrees found
    for (const worktree of worktreesToRemove) {
      try {
        console.log(`  Removing stale worktree: ${worktree.branch} at ${worktree.path}`);
        await executeCommand('git', ['worktree', 'remove', '--force', worktree.path], process.cwd(), time_1min, `removing worktree ${worktree.branch}`, false);
      } catch (error) {
        console.warn(`  ⚠️  Could not remove worktree at ${worktree.path}: ${error.message}`);
      }
    }
    
    // Final prune to clean up any remaining references
    await executeCommand('git', ['worktree', 'prune'], process.cwd(), time_1min, 'final prune', false);
    
    console.log('✅ Worktree cleanup complete\n');
  } catch (error) {
    console.warn(`⚠️  Worktree cleanup encountered issues: ${error.message}\n`);
  }
};

/**
 * Main function to analyze dependency changes between two versions
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} olderVersion - First git reference
 * @param {string} newerVersion - Second git reference
 * @param {string} workingDir - Working directory (optional)
 * @param {string} namespace - Optional namespace to filter second-level dependencies (e.g., @holepunch)
 * @param {boolean} ignoreDevDependencies - Whether to ignore devDependencies (optional)
 * @param {boolean} debugTree - Whether to output debug information about dependency tree (optional)
 * @param {boolean} cleanupWorktrees - Whether to clean up stale worktrees before starting (optional)
 * @param {boolean} generateFullInventory - Whether to generate full dependency inventory (optional)
 * @returns {Promise<Object>} - Analysis report
 */
export const analyzeDependencyChanges = async (repoUrl, olderVersion, newerVersion, workingDir = process.cwd(), namespace = null, ignoreDevDependencies = false, debugTree = false, cleanupWorktrees = false, generateFullInventory = true) => {
  // Setup signal handlers for graceful shutdown
  setupSignalHandlers();
  
  // Clean up stale worktrees if requested
  if (cleanupWorktrees) {
    await cleanupStaleWorktrees();
  }
  
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
    
    // Detect if we're in small screen mode for periodic logging
    const terminalHeight = process.stdout.rows || 24;
    const terminalWidth = process.stdout.columns || 80;
    const isSmallScreen = terminalHeight < 15 || terminalWidth < 60;
    
    // Use git worktrees instead of cloning - this avoids authentication issues
    console.log(`Setting up worktrees for ${olderVersion} and ${newerVersion}...`);
    
    // Fetch the specific refs we need
    try {
      await executeCommand('git', ['fetch', 'origin', olderVersion], process.cwd(), time_2min, `git fetch ${olderVersion}`, isSmallScreen);
    } catch (error) {
      // Try fetching as a tag if direct fetch fails
      try {
        await executeCommand('git', ['fetch', 'origin', `refs/tags/${olderVersion}:refs/tags/${olderVersion}`], process.cwd(), time_2min, `git fetch tag ${olderVersion}`, isSmallScreen);
      } catch (tagError) {
        console.warn(`Warning: Could not fetch ${olderVersion}, will try to use existing ref`);
      }
    }
    
    try {
      await executeCommand('git', ['fetch', 'origin', newerVersion], process.cwd(), time_2min, `git fetch ${newerVersion}`, isSmallScreen);
    } catch (error) {
      // Try fetching as a tag if direct fetch fails
      try {
        await executeCommand('git', ['fetch', 'origin', `refs/tags/${newerVersion}:refs/tags/${newerVersion}`], process.cwd(), time_2min, `git fetch tag ${newerVersion}`, isSmallScreen);
      } catch (tagError) {
        console.warn(`Warning: Could not fetch ${newerVersion}, will try to use existing ref`);
      }
    }
    
    // Create worktrees for each version, handling the case where one version is already checked out
    const currentBranch = await executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], process.cwd(), time_1min, 'get current branch', false);
    const currentBranchName = currentBranch.trim();
    
    console.log(`Current branch: ${currentBranchName}`);
    console.log(`Older version: ${olderVersion}`);
    console.log(`Newer version: ${newerVersion}`);
    
    // Check if either version is the currently checked out branch
    const olderIsCurrentBranch = currentBranchName === olderVersion;
    const newerIsCurrentBranch = currentBranchName === newerVersion;
    
    if (olderIsCurrentBranch) {
      // Copy current working directory to older version directory
      console.log(`Using current working directory for ${olderVersion} (currently checked out)...`);
      await executeCommand('cp', ['-r', '.', olderVersionDir], process.cwd(), time_1min, `copy current dir to ${olderVersion}`, isSmallScreen);
      // Remove the .git directory from the copy to avoid conflicts
      await executeCommand('rm', ['-rf', `${olderVersionDir}/.git`], process.cwd(), time_1min, 'cleanup git dir', false);
      
      // Create worktree for newer version only
      console.log(`Creating worktree for ${newerVersion}...`);
      await executeCommand('git', ['worktree', 'add', newerVersionDir, newerVersion], process.cwd(), time_1min, `git worktree add ${newerVersion}`, isSmallScreen);
    } else if (newerIsCurrentBranch) {
      // Copy current working directory to newer version directory
      console.log(`Using current working directory for ${newerVersion} (currently checked out)...`);
      await executeCommand('cp', ['-r', '.', newerVersionDir], process.cwd(), time_1min, `copy current dir to ${newerVersion}`, isSmallScreen);
      // Remove the .git directory from the copy to avoid conflicts
      await executeCommand('rm', ['-rf', `${newerVersionDir}/.git`], process.cwd(), time_1min, 'cleanup git dir', false);
      
      // Create worktree for older version only
      console.log(`Creating worktree for ${olderVersion}...`);
      await executeCommand('git', ['worktree', 'add', olderVersionDir, olderVersion], process.cwd(), time_1min, `git worktree add ${olderVersion}`, isSmallScreen);
    } else {
      // Neither version is currently checked out, create both worktrees normally
      console.log(`Creating worktrees for both ${olderVersion} and ${newerVersion}...`);
      await executeCommand('git', ['worktree', 'add', olderVersionDir, olderVersion], process.cwd(), time_1min, `git worktree add ${olderVersion}`, isSmallScreen);
      await executeCommand('git', ['worktree', 'add', newerVersionDir, newerVersion], process.cwd(), time_1min, `git worktree add ${newerVersion}`, isSmallScreen);
    }
    
    // Install dependencies for both versions
    await installDependencies(olderVersionDir, isSmallScreen);
    await installDependencies(newerVersionDir, isSmallScreen);
    
    // Scan node_modules to capture actual installed versions on disk
    console.log('Scanning installed packages from node_modules...');
    const olderInstalledPackages = await scanNodeModulesRecursive(olderVersionDir);
    const newerInstalledPackages = await scanNodeModulesRecursive(newerVersionDir);
    const installed = {
      older: buildInstalledSnapshot(olderInstalledPackages),
      newer: buildInstalledSnapshot(newerInstalledPackages)
    };
    console.log(`Found ${Object.keys(installed.older).length} packages in older version, ${Object.keys(installed.newer).length} in newer version`);
    
    // Read .dcrignore from current directory (repository root)
    console.log('Checking for .dcrignore file...');
    const { exactMatches: dcrIgnoreExact, patterns: dcrIgnorePatterns } = await getDcrIgnoreList(process.cwd());
    
    const totalDcrIgnoreRules = dcrIgnoreExact.size + dcrIgnorePatterns.length;
    if (totalDcrIgnoreRules > 0) {
      console.log(`Found .dcrignore file with ${totalDcrIgnoreRules} rules (${dcrIgnoreExact.size} exact, ${dcrIgnorePatterns.length} patterns):`);
      
      if (dcrIgnoreExact.size > 0) {
        const exactArray = Array.from(dcrIgnoreExact).sort();
        console.log(`  Exact: ${exactArray.slice(0, 5).join(', ')}${exactArray.length > 5 ? ` ... and ${exactArray.length - 5} more` : ''}`);
      }
      
      if (dcrIgnorePatterns.length > 0) {
        console.log(`  Patterns: ${dcrIgnorePatterns.slice(0, 5).join(', ')}${dcrIgnorePatterns.length > 5 ? ` ... and ${dcrIgnorePatterns.length - 5} more` : ''}`);
      }
    }
    
    // Collect dev dependencies if ignoring them
    let allDevDeps = new Set();
    let ignoredDevDependencies = [];
    let ignoredFromDcrIgnore = [];
    
    if (ignoreDevDependencies) {
      console.log('Collecting dev dependencies to filter...');
      const olderDevDeps = await collectAllDevDependencies(olderVersionDir);
      const newerDevDeps = await collectAllDevDependencies(newerVersionDir);
      
      // Combine dev dependencies from both versions
      allDevDeps = new Set([...olderDevDeps, ...newerDevDeps]);
      ignoredDevDependencies = Array.from(allDevDeps).sort();
      
      console.log(`Found ${allDevDeps.size} dev dependencies (including nested) to filter out:`);
      console.log(`  ${ignoredDevDependencies.slice(0, 10).join(', ')}${ignoredDevDependencies.length > 10 ? ` ... and ${ignoredDevDependencies.length - 10} more` : ''}`);
    }
    
    // Merge .dcrignore list with dev dependencies
    // We need to collect all packages that match .dcrignore patterns
    if (totalDcrIgnoreRules > 0) {
      // We'll collect matched packages as we process dependencies
      // For now, add exact matches to allDevDeps
      for (const pkg of dcrIgnoreExact) {
        allDevDeps.add(pkg);
      }
      
      console.log(`Added ${dcrIgnoreExact.size} exact matches from .dcrignore to ignore list`);
    }
    
    // Helper function to recursively filter out dev dependencies from nested structures
    const recursivelyFilterDevDeps = (deps, devDeps, exactMatches, patterns) => {
      const filtered = {};
      for (const [name, info] of Object.entries(deps)) {
        // Skip if this is a dev dependency
        if (devDeps.has(name)) {
          continue;
        }
        
        // Skip if this matches a .dcrignore pattern
        if (shouldIgnorePackage(name, exactMatches, patterns)) {
          // Track this for reporting
          if (!ignoredFromDcrIgnore.includes(name)) {
            ignoredFromDcrIgnore.push(name);
          }
          continue;
        }
        
        // Copy the dependency info
        filtered[name] = { ...info };
        
        // Recursively filter nested dependencies if they exist
        if (info.dependencies) {
          const filteredNested = recursivelyFilterDevDeps(info.dependencies, devDeps, exactMatches, patterns);
          if (Object.keys(filteredNested).length > 0) {
            filtered[name].dependencies = filteredNested;
          } else {
            delete filtered[name].dependencies;
          }
        }
      }
      return filtered;
    };
    
    // Get dependencies for both versions, with namespace filtering for second-level dependencies if specified
    const olderDeps = await getDependencies(olderVersionDir, namespace);
    const newerDeps = await getDependencies(newerVersionDir, namespace);
    
    // Debug output: show dependency tree before filtering
    if (debugTree) {
      console.log('\n=== DEBUG: Dependency Tree BEFORE Filtering ===\n');
      console.log(`Total dependencies in newer version: ${Object.keys(newerDeps).length}`);
      
      // Show jest-related dependencies
      const jestRelated = Object.keys(newerDeps).filter(name => 
        name.includes('jest') || name.includes('@jest')
      );
      if (jestRelated.length > 0) {
        console.log(`\nJest-related top-level dependencies (${jestRelated.length}):`);
        jestRelated.forEach(name => {
          const info = newerDeps[name];
          console.log(`  - ${name}@${info.version}`);
          if (info.dependencies) {
            const nestedJest = Object.keys(info.dependencies).filter(n => 
              n.includes('jest') || n.includes('@jest')
            );
            if (nestedJest.length > 0) {
              console.log(`    Nested jest deps: ${nestedJest.join(', ')}`);
            }
          }
        });
      }
      
      // Show all dev dependencies that will be filtered
      if (ignoreDevDependencies && allDevDeps.size > 0) {
        console.log(`\nDev dependencies to filter (${allDevDeps.size}):`);
        const devDepsArray = Array.from(allDevDeps).sort();
        const jestDevDeps = devDepsArray.filter(name => 
          name.includes('jest') || name.includes('@jest')
        );
        if (jestDevDeps.length > 0) {
          console.log(`  Jest-related (${jestDevDeps.length}): ${jestDevDeps.slice(0, 20).join(', ')}${jestDevDeps.length > 20 ? ` ... and ${jestDevDeps.length - 20} more` : ''}`);
        }
        console.log(`  Total: ${devDepsArray.slice(0, 10).join(', ')}${devDepsArray.length > 10 ? ` ... and ${devDepsArray.length - 10} more` : ''}`);
      }
    }
    
    // Filter out dev dependencies and .dcrignore patterns (recursively to handle nested deps)
    const shouldFilter = ignoreDevDependencies || totalDcrIgnoreRules > 0;
    const filteredOlderDeps = shouldFilter ? 
      recursivelyFilterDevDeps(olderDeps, allDevDeps, dcrIgnoreExact, dcrIgnorePatterns) : 
      olderDeps;
    const filteredNewerDeps = shouldFilter ? 
      recursivelyFilterDevDeps(newerDeps, allDevDeps, dcrIgnoreExact, dcrIgnorePatterns) : 
      newerDeps;
    
    // Sort and log ignored packages from .dcrignore
    if (ignoredFromDcrIgnore.length > 0) {
      ignoredFromDcrIgnore.sort();
      console.log(`Filtered ${ignoredFromDcrIgnore.length} packages matching .dcrignore patterns`);
    }
    
    // Debug output: show dependency tree after filtering
    if (debugTree) {
      console.log('\n=== DEBUG: Dependency Tree AFTER Filtering ===\n');
      console.log(`Total dependencies in newer version: ${Object.keys(filteredNewerDeps).length}`);
      
      // Show any remaining jest-related dependencies
      const remainingJest = Object.keys(filteredNewerDeps).filter(name => 
        name.includes('jest') || name.includes('@jest')
      );
      if (remainingJest.length > 0) {
        console.log(`\n⚠️  WARNING: Jest-related dependencies still present (${remainingJest.length}):`);
        remainingJest.forEach(name => {
          const info = filteredNewerDeps[name];
          console.log(`  - ${name}@${info.version}`);
          if (info.dependencies) {
            const nestedJest = Object.keys(info.dependencies).filter(n => 
              n.includes('jest') || n.includes('@jest')
            );
            if (nestedJest.length > 0) {
              console.log(`    Nested jest deps: ${nestedJest.join(', ')}`);
            }
          }
        });
      } else {
        console.log('\n✅ No jest-related dependencies remaining after filtering');
      }
      
      console.log('\n=== END DEBUG ===\n');
    }
    
    // Get package changes from package-lock.json if available
    const { changedPackages: lockFileChanges, packageVersions } = await getPackageLockChanges(olderVersionDir, newerVersionDir);
    
    // Compare dependencies, passing packageVersions for devDep information and allDevDeps for filtering
    const comparison = compareDependencies(filteredOlderDeps, filteredNewerDeps, packageVersions, allDevDeps);
    
    // Create a combined list of packages to get changelogs for
    let allChangedPackages = [...comparison.upgraded];
    
    // Filter out dev dependencies if ignoreDevDependencies is true
    if (ignoreDevDependencies) {
      allChangedPackages = allChangedPackages.filter(dep => !allDevDeps.has(dep.name));
    }
    
    // Add any packages from lock file that aren't already in our list
    for (const packageName of lockFileChanges) {
      // Skip if this is a nested dependency path (contains /node_modules/)
      if (packageName.includes('/node_modules/')) {
        continue;
      }
      
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
                changeType: changeType,
                devDep: versionInfo.devDep || false
              };
              
              // Skip if this matches a .dcrignore pattern
              if (shouldIgnorePackage(packageName, dcrIgnoreExact, dcrIgnorePatterns)) {
                if (!ignoredFromDcrIgnore.includes(packageName)) {
                  ignoredFromDcrIgnore.push(packageName);
                }
                continue;
              }

              // Only add if not ignoring dev dependencies or if it's not a dev dependency
              if (!ignoreDevDependencies || !allDevDeps.has(packageName)) {
                // Add to the list for changelog generation
                allChangedPackages.push(lockFileDep);
                
                // Also add to the comparison.upgraded array so it appears in the report
                comparison.upgraded.push(lockFileDep);
              }
              
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
      let modifiedDepsForChangelog = comparison.modified.map(dep => ({
        name: dep.newName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        changeType: 'namespace',
        devDep: dep.devDep || false
      }));
      
      // Filter out dev dependencies and .dcrignore matches
      if (ignoreDevDependencies || totalDcrIgnoreRules > 0) {
        modifiedDepsForChangelog = modifiedDepsForChangelog.filter(dep => {
          if (ignoreDevDependencies && allDevDeps.has(dep.name)) return false;
          if (shouldIgnorePackage(dep.name, dcrIgnoreExact, dcrIgnorePatterns)) {
            if (!ignoredFromDcrIgnore.includes(dep.name)) {
              ignoredFromDcrIgnore.push(dep.name);
            }
            return false;
          }
          return true;
        });
      }
      
      if (modifiedDepsForChangelog.length > 0) {
        const { changelogs: modifiedChangelogs, errors: modifiedErrors, ciStatus: modifiedCiStatus } = 
          await getChangelogs(modifiedDepsForChangelog, newerVersionDir, reposDir);
      
        // Merge changelogs, errors, and CI status
        Object.assign(changelogs, modifiedChangelogs);
        Object.assign(errors, modifiedErrors);
        Object.assign(ciStatus, modifiedCiStatus);
      }
    }
    
    // Get changelogs for nested upgraded dependencies
    if (comparison.nested.upgraded.length > 0) {
      console.log(`Generating changelogs for ${comparison.nested.upgraded.length} nested upgraded dependencies...`);
      let nestedUpgradedDeps = comparison.nested.upgraded;
      
      // Filter out dev dependencies and .dcrignore matches
      if (ignoreDevDependencies || totalDcrIgnoreRules > 0) {
        nestedUpgradedDeps = nestedUpgradedDeps.filter(dep => {
          if (ignoreDevDependencies && allDevDeps.has(dep.name)) return false;
          if (shouldIgnorePackage(dep.name, dcrIgnoreExact, dcrIgnorePatterns)) {
            if (!ignoredFromDcrIgnore.includes(dep.name)) {
              ignoredFromDcrIgnore.push(dep.name);
            }
            return false;
          }
          return true;
        });
      }
      
      if (nestedUpgradedDeps.length > 0) {
        const { changelogs: nestedChangelogs, errors: nestedErrors, ciStatus: nestedCiStatus } = 
          await getChangelogs(nestedUpgradedDeps, newerVersionDir, reposDir);
        
        // Merge nested changelogs, errors, and CI status
        Object.assign(changelogs, nestedChangelogs);
        Object.assign(errors, nestedErrors);
        Object.assign(ciStatus, nestedCiStatus);
      }
    }
    
    // Generate full inventory if requested (reuse already-scanned packages)
    let fullInventory = null;
    if (generateFullInventory) {
      console.log('\n📦 Generating full dependency inventory...');
      
      fullInventory = buildInventoryTable(olderInstalledPackages, newerInstalledPackages);
      console.log(`Found ${fullInventory.length} unique packages across both versions`);
      
      // Count conflicts
      const oldConflicts = fullInventory.filter(i => i.hasOldConflict).length;
      const newConflicts = fullInventory.filter(i => i.hasNewConflict).length;
      if (oldConflicts > 0 || newConflicts > 0) {
        console.log(`⚠️  Version conflicts detected: ${oldConflicts} in old version, ${newConflicts} in new version`);
      }
      
    }
    
    // Prepare missedUpgrades variable for report
    let missedUpgrades = null;
    
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
      installed,
      namespace: namespace || null,
      ignoredDevDependencies: ignoreDevDependencies ? ignoredDevDependencies : null,
      ignoredFromDcrIgnore: ignoredFromDcrIgnore.length > 0 ? ignoredFromDcrIgnore : null,
      fullInventory: fullInventory,
      missedUpgrades: missedUpgrades
    };
    
    // Second pass: Check for missed upgrades if full inventory was generated
    if (generateFullInventory && fullInventory) {
      console.log('\n🔍 Cross-checking inventory against detected changes...');
      const foundMissedUpgrades = [];
      
      for (const item of fullInventory) {
        // Check if this is an upgrade (both versions exist and are different)
        if (item.oldVersion && item.newVersion && item.oldVersion !== item.newVersion) {
          // Check if it's in our upgraded list
          const foundInUpgraded = comparison.upgraded.some(dep => dep.name === item.name);
          const foundInNestedUpgraded = comparison.nested?.upgraded?.some(dep => dep.name === item.name);
          
          if (!foundInUpgraded && !foundInNestedUpgraded) {
            foundMissedUpgrades.push({
              name: item.name,
              oldVersion: item.oldVersion,
              newVersion: item.newVersion,
              oldLevel: item.oldLevel,
              newLevel: item.newLevel,
              hasOldConflict: item.hasOldConflict,
              hasNewConflict: item.hasNewConflict,
              // Debug info
              inOldDeps: !!filteredOlderDeps[item.name],
              inNewDeps: !!filteredNewerDeps[item.name],
              inAllDevDeps: allDevDeps.has(item.name),
              inDcrIgnore: shouldIgnorePackage(item.name, dcrIgnoreExact, dcrIgnorePatterns)
            });
          }
        }
      }
      
      if (foundMissedUpgrades.length > 0) {
        console.log(`\n⚠️  Found ${foundMissedUpgrades.length} upgraded dependencies that were missed in first pass:`);
        foundMissedUpgrades.forEach(dep => {
          console.log(`\n📦 ${dep.name}`);
          console.log(`   Versions: ${dep.oldVersion} → ${dep.newVersion}`);
          console.log(`   Level: ${dep.oldLevel} → ${dep.newLevel}`);
          console.log(`   Version conflicts: old=${dep.hasOldConflict}, new=${dep.hasNewConflict}`);
          console.log(`   Debug info:`);
          console.log(`     - In filtered old deps: ${dep.inOldDeps}`);
          console.log(`     - In filtered new deps: ${dep.inNewDeps}`);
          console.log(`     - In allDevDeps: ${dep.inAllDevDeps}`);
          console.log(`     - In .dcrignore: ${dep.inDcrIgnore}`);
        });
        
        // Update report with missed upgrades
        report.missedUpgrades = foundMissedUpgrades;
        
        // Process missed upgrades and add them to the main report
        console.log(`\n🔄 Processing ${foundMissedUpgrades.length} missed upgrades...`);
        
        // Convert missed upgrades to the format expected by getChangelogs
        const missedUpgradesForChangelog = foundMissedUpgrades
          .map(dep => {
            // Parse versions into arrays
            const oldVersions = dep.oldVersion.split(',').map(v => v.trim());
            const newVersions = dep.newVersion.split(',').map(v => v.trim());
            
            // Find the highest version in each set
            let oldVer = oldVersions[0];
            let newVer = newVersions[0];
            
            try {
              // Get the highest valid semver version from each set
              const validOldVersions = oldVersions.filter(v => semver.valid(v));
              const validNewVersions = newVersions.filter(v => semver.valid(v));
              
              if (validOldVersions.length > 0) {
                oldVer = validOldVersions.reduce((highest, current) => 
                  semver.gt(current, highest) ? current : highest
                );
              }
              
              if (validNewVersions.length > 0) {
                newVer = validNewVersions.reduce((highest, current) => 
                  semver.gt(current, highest) ? current : highest
                );
              }
            } catch (error) {
              // If semver comparison fails, use first versions
            }
            
            // Determine change type using semver if possible
            let changeType = 'unknown';
            try {
              if (semver.valid(oldVer) && semver.valid(newVer)) {
                if (semver.major(newVer) > semver.major(oldVer)) {
                  changeType = 'major';
                } else if (semver.minor(newVer) > semver.minor(oldVer)) {
                  changeType = 'minor';
                } else if (semver.patch(newVer) > semver.patch(oldVer)) {
                  changeType = 'patch';
                }
              }
            } catch (error) {
              console.warn(`Warning: Could not determine semver change type for ${dep.name}: ${error.message}`);
            }
            
            return {
              name: dep.name,
              oldVersion: oldVer,
              newVersion: newVer,
              changeType: changeType,
              devDep: allDevDeps.has(dep.name),
              fromMissedUpgrades: true,
              hadConflict: dep.hasOldConflict || dep.hasNewConflict
            };
          })
          .filter(dep => {
            // Skip if ignoring dev deps and this is a dev dependency
            if (ignoreDevDependencies && allDevDeps.has(dep.name)) {
              return false;
            }
            // Skip if this matches a .dcrignore rule
            if (shouldIgnorePackage(dep.name, dcrIgnoreExact, dcrIgnorePatterns)) {
              return false;
            }
            // Skip if versions are identical (no actual upgrade)
            if (dep.oldVersion === dep.newVersion) {
              console.log(`  Skipping ${dep.name}: versions are identical (${dep.oldVersion})`);
              return false;
            }
            return true;
          });
        
        // Get changelogs for missed upgrades
        const { changelogs: missedChangelogs, errors: missedErrors, ciStatus: missedCiStatus } = 
          await getChangelogs(missedUpgradesForChangelog, newerVersionDir, reposDir);
        
        // Merge into main report
        Object.assign(changelogs, missedChangelogs);
        Object.assign(errors, missedErrors);
        Object.assign(ciStatus, missedCiStatus);
        
        // Add to the appropriate changes section based on level
        for (const dep of missedUpgradesForChangelog) {
          const missedInfo = foundMissedUpgrades.find(m => m.name === dep.name);
          
          if (missedInfo.oldLevel === 'top-level' && missedInfo.newLevel === 'top-level') {
            // Add to top-level upgraded
            comparison.upgraded.push(dep);
          } else {
            // Add to nested upgraded
            if (!comparison.nested) {
              comparison.nested = { added: [], upgraded: [], removed: [], modified: [] };
            }
            comparison.nested.upgraded.push({
              ...dep,
              parent: 'unknown' // We don't have parent info from inventory
            });
          }
        }
        
        console.log(`✅ Added ${foundMissedUpgrades.length} missed upgrades to main report`);
      } else {
        console.log('✅ All upgraded dependencies were detected correctly');
      }
    }
    
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Add reportPath after writing the file
    report.reportPath = reportPath;
    
    console.log(`\n📊 Report generated: ${reportPath}`);
    
    // Clean up worktrees (only remove actual worktrees, not copied directories)
    try {
      const currentBranch = await executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], process.cwd(), time_1min, 'get current branch', false);
      const currentBranchName = currentBranch.trim();
      
      if (currentBranchName !== olderVersion) {
        try {
          await executeCommand('git', ['worktree', 'remove', olderVersionDir], process.cwd(), time_1min, 'cleanup older worktree', false);
        } catch (removeError) {
          // If normal remove fails, try with --force
          await executeCommand('git', ['worktree', 'remove', '--force', olderVersionDir], process.cwd(), time_1min, 'force cleanup older worktree', false);
        }
      }
      if (currentBranchName !== newerVersion) {
        try {
          await executeCommand('git', ['worktree', 'remove', newerVersionDir], process.cwd(), time_1min, 'cleanup newer worktree', false);
        } catch (removeError) {
          // If normal remove fails, try with --force
          await executeCommand('git', ['worktree', 'remove', '--force', newerVersionDir], process.cwd(), time_1min, 'force cleanup newer worktree', false);
        }
      }
    } catch (cleanupError) {
      console.warn(`⚠️  Failed to clean up worktrees: ${cleanupError.message}`);
    }
    
    // Don't auto-cleanup on success - user might want to examine the files
    // But unregister from emergency cleanup since we completed successfully
    unregisterTempDir(reposDir);
    
    return report;
  } catch (error) {
    console.error(`\n❌ Error analyzing dependency changes: ${error.message}`);
    
    // Clean up worktrees on error (only remove actual worktrees, not copied directories)
    try {
      const currentBranch = await executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], process.cwd(), time_1min, 'get current branch', false);
      const currentBranchName = currentBranch.trim();
      
      if (currentBranchName !== olderVersion) {
        try {
          await executeCommand('git', ['worktree', 'remove', olderVersionDir], process.cwd(), time_1min, 'cleanup older worktree', false);
        } catch (removeError) {
          try {
            // If normal remove fails, try with --force
            await executeCommand('git', ['worktree', 'remove', '--force', olderVersionDir], process.cwd(), time_1min, 'force cleanup older worktree', false);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        }
      }
      if (currentBranchName !== newerVersion) {
        try {
          await executeCommand('git', ['worktree', 'remove', newerVersionDir], process.cwd(), time_1min, 'cleanup newer worktree', false);
        } catch (removeError) {
          try {
            // If normal remove fails, try with --force
            await executeCommand('git', ['worktree', 'remove', '--force', newerVersionDir], process.cwd(), time_1min, 'force cleanup newer worktree', false);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        }
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    // Clean up temp directory
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
