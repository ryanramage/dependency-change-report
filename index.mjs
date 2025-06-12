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
 * @param {number} timeout - Timeout in milliseconds (default: 5 minutes)
 * @returns {Promise<string>} - Command output
 */
const executeCommand = (command, args, cwd, timeout = 300000) => {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';

    // Set up timeout
    const timeoutId = setTimeout(() => {
      process.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
    }, timeout);

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        console.warn(`Warning: Command ${command} ${args.join(' ')} failed with code ${code}`);
        console.warn(`Error: ${stderr}`);
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    process.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
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
 * @param {string} namespace - Optional namespace to filter second-level dependencies
 * @returns {Promise<Object>} - Dependencies object
 */
const getDependencies = async (dir, namespace = null) => {
  try {
    console.log(`Getting dependency list from ${dir}...`);
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
                console.warn(`Warning: Could not read package.json for nested dependency ${nestedName}: ${err.message}`);
              }
            }
          }
          
          // Only add nested dependencies if there are any (after filtering)
          if (Object.keys(nestedDeps).length > 0) {
            info.dependencies = nestedDeps;
          }
        }
      } catch (err) {
        console.warn(`Warning: Could not read package.json for ${name}: ${err.message}`);
      }
    }
    
    return dependencies;
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
    console.warn(`Warning: Could not get repository URL for ${packageDir}: ${error.message}`);
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
  try {
    // Create a directory for the repository within the repos directory
    const packageName = basename(repoUrl, '.git');
    const tempDir = join(reposDir, `${packageName}-history`);
    await mkdir(tempDir, { recursive: true });
    
    // Clone the repository with optimizations for faster cloning
    console.log(`Cloning ${repoUrl} into ${tempDir} to get commit history...`);
    // Use --quiet to avoid printing credentials in logs
    // Use --depth=1 and --single-branch for faster cloning, then fetch what we need
    try {
      await executeCommand('git', ['clone', '--quiet', '--depth=1', '--single-branch', repoUrl, tempDir], undefined, 120000); // 2 minute timeout for clone
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
      await executeCommand('git', ['fetch', '--tags', '--force', '--unshallow'], tempDir, 60000); // 1 minute timeout
    } catch (error) {
      console.warn(`Warning: Failed to fetch tags: ${error.message}`);
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
      try {
        // Make sure we're in the right directory and have fetched everything
        try {
          await executeCommand('git', ['fetch', '--all'], tempDir, 60000); // 1 minute timeout
        } catch (error) {
          console.warn(`Warning: Failed to fetch all refs: ${error.message}`);
          // Continue without full fetch
        }
        
        // Try to get the commit hash for the reference
        const result = await executeCommand('git', ['rev-parse', '--verify', ref], tempDir);
        return { ref: ref, hash: result.trim() };
      } catch (error) {
        // If not found, try with 'v' prefix
        if (!ref.startsWith('v')) {
          try {
            const result = await executeCommand('git', ['rev-parse', '--verify', `v${ref}`], tempDir);
            return { ref: `v${ref}`, hash: result.trim() };
          } catch (e) {
            // Try as a tag
            try {
              const result = await executeCommand('git', ['rev-parse', '--verify', `refs/tags/${ref}`], tempDir);
              return { ref: ref, hash: result.trim() };
            } catch (e2) {
              // Try with v prefix as a tag
              if (!ref.startsWith('v')) {
                try {
                  const result = await executeCommand('git', ['rev-parse', '--verify', `refs/tags/v${ref}`], tempDir);
                  return { ref: `v${ref}`, hash: result.trim() };
                } catch (e3) {
                  // Neither version found as direct reference
                  return null;
                }
              }
              return null;
            }
          }
        } else {
          // Try as a tag if it already has v prefix
          try {
            const result = await executeCommand('git', ['rev-parse', '--verify', `refs/tags/${ref}`], tempDir);
            return { ref: ref, hash: result.trim() };
          } catch (e) {
            return null;
          }
        }
      }
    };
    
    // Find commit with version bump
    const findVersionCommit = async (version) => {
      try {
        console.log(`Looking for commit that bumps version to ${version}...`);
        
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
              console.log(`Found commit for version ${version} using pattern: ${pattern}`);
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
            console.log(`Found commit that changes package.json version to ${version}`);
            return { ref: version, hash: result.trim() };
          }
        } catch (e) {
          // Continue to next approach
        }
        
        return null;
      } catch (error) {
        console.warn(`Error finding version commit: ${error.message}`);
        return null;
      }
    };
    
    // Resolve references
    let resolvedOldRef = await checkRef(oldRef);
    let resolvedNewRef = await checkRef(newRef);
    
    // If direct references not found, try to find commits with version bumps
    if (!resolvedOldRef) {
      console.log(`Reference ${oldVersion} not found directly, looking for version bump commit...`);
      resolvedOldRef = await findVersionCommit(oldVersion);
    }
    
    if (!resolvedNewRef) {
      console.log(`Reference ${newVersion} not found directly, looking for version bump commit...`);
      resolvedNewRef = await findVersionCommit(newVersion);
    }
    
    // Last resort: if we can't find specific versions, use default branch for newer and first commit for older
    if (!resolvedOldRef && !resolvedNewRef) {
      console.warn(`Warning: Could not find references for both ${oldVersion} and ${newVersion}. Using first and latest commits instead.`);
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
        
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
        
        console.log(`Using first commit (${resolvedOldRef.hash.substring(0, 7)}) and latest commit (${resolvedNewRef.hash.substring(0, 7)}) as fallback`);
      } catch (error) {
        console.warn(`Warning: Failed to get first and latest commits: ${error.message}`);
        return [];
      }
    } else if (!resolvedOldRef) {
      console.warn(`Warning: Could not find reference for ${oldVersion}. Using first commit instead.`);
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
        console.log(`Using first commit (${resolvedOldRef.hash.substring(0, 7)}) as fallback for ${oldVersion}`);
      } catch (error) {
        console.warn(`Warning: Failed to get first commit: ${error.message}`);
        return [];
      }
    } else if (!resolvedNewRef) {
      console.warn(`Warning: Could not find reference for ${newVersion}. Using latest commit instead.`);
      try {
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
        console.log(`Using latest commit (${resolvedNewRef.hash.substring(0, 7)}) as fallback for ${newVersion}`);
      } catch (error) {
        console.warn(`Warning: Failed to get latest commit: ${error.message}`);
        return [];
      }
    }
    
    // Get commit history between versions
    // Format: hash,author,date,message
    console.log(`Getting commits between ${resolvedOldRef.ref} (${resolvedOldRef.hash.substring(0, 7)}) and ${resolvedNewRef.ref} (${resolvedNewRef.hash.substring(0, 7)})...`);
    
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
        console.log('Detected reversed version order, swapping references...');
        const temp = resolvedOldRef;
        resolvedOldRef = resolvedNewRef;
        resolvedNewRef = temp;
      }
    } catch (error) {
      console.warn(`Warning: Could not determine commit order: ${error.message}`);
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
      console.warn(`Warning: Failed to get commit log: ${error.message}`);
      // Try with a different approach - get all commits and filter
      try {
        console.log('Trying alternative approach to get commit history...');
        output = await executeCommand(
          'git',
          ['log', '--pretty=format:%H,%an,%ad,%s'],
          tempDir
        );
      } catch (e) {
        console.warn(`Warning: Alternative approach also failed: ${e.message}`);
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
 * @param {string} reposDir - Repository directory
 * @returns {Promise<Object>} - Object mapping package names to changelogs
 */
const getChangelogs = async (upgradedDeps, newerVersionDir, reposDir) => {
  const changelogs = {};
  const errors = {};
  
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
      
      console.log(`Getting changelog for ${dep.name} from ${cleanRepoUrl} between ${dep.oldVersion} and ${dep.newVersion}`);
      
      try {
        const commits = await getCommitHistory(cleanRepoUrl, dep.oldVersion, dep.newVersion, reposDir);
        if (commits.length > 0) {
          changelogs[dep.name] = {
            repoUrl: cleanRepoUrl,
            oldVersion: dep.oldVersion,
            newVersion: dep.newVersion,
            commits
          };
        } else {
          console.warn(`No commits found between ${dep.oldVersion} and ${dep.newVersion} for ${dep.name}`);
          errors[dep.name] = {
            repoUrl: cleanRepoUrl,
            oldVersion: dep.oldVersion,
            newVersion: dep.newVersion,
            error: "No commits found between versions"
          };
        }
      } catch (error) {
        console.warn(`Error getting changelog for ${dep.name}: ${error.message}`);
        errors[dep.name] = {
          repoUrl: cleanRepoUrl,
          oldVersion: dep.oldVersion,
          newVersion: dep.newVersion,
          error: error.message
        };
      }
    }
  }
  
  return { changelogs, errors };
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
        console.warn(`Warning: Could not determine semver change type for ${name}: ${error.message}`);
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
          console.warn(`Warning: Could not determine semver change type for nested dependency ${name}: ${error.message}`);
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
    
    // Get dependencies for both versions, with namespace filtering for second-level dependencies if specified
    const olderDeps = await getDependencies(olderVersionDir, namespace);
    const newerDeps = await getDependencies(newerVersionDir, namespace);
    
    // Compare dependencies
    const comparison = compareDependencies(olderDeps, newerDeps);
    
    // Get changelogs for upgraded dependencies
    console.log('Generating changelogs for upgraded dependencies...');
    const { changelogs, errors } = await getChangelogs(comparison.upgraded, newerVersionDir, reposDir);
  
    // Get changelogs for modified dependencies (namespace changes)
    console.log('Generating changelogs for modified dependencies...');
    const modifiedDepsForChangelog = comparison.modified.map(dep => ({
      name: dep.newName,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
      changeType: 'namespace'
    }));
    const { changelogs: modifiedChangelogs, errors: modifiedErrors } = 
      await getChangelogs(modifiedDepsForChangelog, newerVersionDir, reposDir);
  
    // Merge changelogs and errors
    Object.assign(changelogs, modifiedChangelogs);
    Object.assign(errors, modifiedErrors);
    
    // Get changelogs for nested upgraded dependencies
    console.log('Generating changelogs for nested upgraded dependencies...');
    const { changelogs: nestedChangelogs, errors: nestedErrors } = 
      await getChangelogs(comparison.nested.upgraded, newerVersionDir, reposDir);
    
    // Merge nested changelogs and errors
    Object.assign(changelogs, nestedChangelogs);
    Object.assign(errors, nestedErrors);
    
    // Create report
    const report = {
      repository: repoUrl,
      olderVersion: olderVersion,
      newerVersion: newerVersion,
      timestamp: new Date().toISOString(),
      changes: comparison,
      changelogs,
      errors,
      namespace: namespace || null
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

export { analyzeDependencyChanges };
