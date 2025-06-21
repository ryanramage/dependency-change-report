import { join, basename } from 'path';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import semver from 'semver';
import PQueue from 'p-queue';

// Import utilities
import { setupSignalHandlers, registerTempDir, unregisterTempDir } from '../utils/cleanup-manager.mjs';
import { createMultiProgressBar, stopMultiProgressBar, shouldUseProgressBars } from '../utils/progress-manager.mjs';

// Import external services
import { cloneRepo } from '../git/repository.mjs';
import { getGitHubActionsStatus } from '../external/github-api.mjs';
import { installDependencies, getDependencies } from '../npm/dependencies.mjs';
import { getRepositoryUrl, cleanRepositoryUrl } from '../npm/package-info.mjs';

// Import core logic
import { getPackageLockChanges } from './package-lock-parser.mjs';
import { compareDependencies } from './dependency-comparer.mjs';

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
        error: "No commits found between versions"
      };
    }
  } catch (error) {
    if (depBar) {
      depBar.update(70, { status: '❌ Commit error' });
    } else if (!useProgressBars) {
      console.log(`  ❌ ${dep.name}: Error getting commits - ${error.message}`);
    }
    result.error = {
      repoUrl: cleanRepoUrl,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      error: error.message
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
 * Main function to analyze dependency changes between two versions
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} olderVersion - First git reference
 * @param {string} newerVersion - Second git reference
 * @param {string} workingDir - Working directory (optional)
 * @param {string} namespace - Optional namespace to filter second-level dependencies (e.g., @holepunch)
 * @returns {Promise<Object>} - Analysis report
 */
export const analyzeDependencyChanges = async (repoUrl, olderVersion, newerVersion, workingDir = process.cwd(), namespace = null) => {
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
    
    // Detect if we're in small screen mode for periodic logging
    const terminalHeight = process.stdout.rows || 24;
    const terminalWidth = process.stdout.columns || 80;
    const isSmallScreen = terminalHeight < 15 || terminalWidth < 60;
    
    // Clone both versions
    await cloneRepo(repoUrl, olderVersion, olderVersionDir, isSmallScreen);
    await cloneRepo(repoUrl, newerVersion, newerVersionDir, isSmallScreen);
    
    // Install dependencies for both versions
    await installDependencies(olderVersionDir, isSmallScreen);
    await installDependencies(newerVersionDir, isSmallScreen);
    
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
