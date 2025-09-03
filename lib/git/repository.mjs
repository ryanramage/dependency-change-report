import { basename, join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { executeCommand, time_5min, time_2min, time_1min } from '../utils/command-executor.mjs';
import { registerTempDir, unregisterTempDir } from '../utils/cleanup-manager.mjs';

/**
 * Clone a GitHub repository at a specific reference
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref - Git reference (tag, branch, commit)
 * @param {string} targetDir - Directory to clone into
 * @param {boolean} enablePeriodicLogging - Whether to enable periodic logging for long operations
 * @returns {Promise<void>}
 */
export const cloneRepo = async (repoUrl, ref, targetDir, enablePeriodicLogging = false) => {
  const repoName = basename(repoUrl, '.git');
  
  // Apply GitHub token authentication if in GitHub Actions
  let authenticatedRepoUrl = repoUrl;
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  if (isGitHubActions && repoUrl.includes('github.com')) {
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      authenticatedRepoUrl = repoUrl.replace('https://github.com/', `https://${token}:x-oauth-basic@github.com/`);
    }
  }
  
  try {
    // Use shallow clone with depth=1 and single-branch for faster cloning
    // Use --quiet to avoid printing credentials in logs
    // 2 minute timeout for very large repositories
    await executeCommand('git', ['clone', '--quiet', '--depth=1', '--single-branch', '--branch', ref, authenticatedRepoUrl, targetDir], undefined, time_2min, `git clone of ${repoName} (${ref})`, enablePeriodicLogging);
  } catch (error) {
    // If shallow clone with specific branch fails, try traditional approach
    try {
      // Full clone with 5 minute timeout for very large repos
      await executeCommand('git', ['clone', '--quiet', authenticatedRepoUrl, targetDir], undefined, time_5min, `git clone of ${repoName} (full)`, enablePeriodicLogging);
      await executeCommand('git', ['checkout', ref], targetDir, time_1min, `git checkout ${ref}`, enablePeriodicLogging);
    } catch (fallbackError) {
      throw fallbackError;
    }
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
export const getCommitHistory = async (repoUrl, oldVersion, newVersion, reposDir) => {
  let tempDir = null;
  
  try {
    // Create a directory for the repository within the repos directory
    const packageName = basename(repoUrl, '.git');
    tempDir = join(reposDir, `${packageName}-history`);
    await mkdir(tempDir, { recursive: true });
    
    // Register this temp directory for cleanup
    registerTempDir(tempDir);
    
    // Apply GitHub token authentication if in GitHub Actions
    let authenticatedRepoUrl = repoUrl;
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    if (isGitHubActions && repoUrl.includes('github.com')) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        authenticatedRepoUrl = repoUrl.replace('https://github.com/', `https://${token}:x-oauth-basic@github.com/`);
      }
    }
    
    // Clone the repository with retry logic and better error handling
    const cloneWithRetry = async (retryCount = 0) => {
      const maxRetries = 3;
      
      try {
        // Try different clone strategies based on retry count
        if (retryCount === 0) {
          // First attempt: shallow clone with single branch
          await executeCommand('git', ['clone', '--quiet', '--depth=50', '--single-branch', authenticatedRepoUrl, tempDir], undefined, time_2min, `git clone of ${packageName} for history`, false);
        } else if (retryCount === 1) {
          // Second attempt: shallow clone without single branch
          await executeCommand('git', ['clone', '--quiet', '--depth=50', authenticatedRepoUrl, tempDir], undefined, time_2min, `git clone of ${packageName} for history (retry ${retryCount})`, false);
        } else {
          // Final attempt: full clone
          await executeCommand('git', ['clone', '--quiet', authenticatedRepoUrl, tempDir], undefined, time_5min, `git clone of ${packageName} for history (full clone)`, false);
        }
      } catch (error) {
        if (retryCount < maxRetries) {
          console.log(`Clone failed for ${packageName}, retrying (${retryCount + 1}/${maxRetries + 1})...`);
          
          // Clean up failed attempt
          try {
            await rm(tempDir, { recursive: true, force: true });
            unregisterTempDir(tempDir);
            await mkdir(tempDir, { recursive: true });
            registerTempDir(tempDir);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
          
          // Wait before retry (exponential backoff)
          const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000; // 1-2s, 2-3s, 4-5s
          await new Promise(resolve => setTimeout(resolve, delay));
          
          return cloneWithRetry(retryCount + 1);
        }
        
        // If all retries failed, throw a categorized error
        let errorCategory = 'unknown';
        let errorMessage = error.message;
        
        if (error.message.includes('Authentication failed') || error.message.includes('Permission denied')) {
          errorCategory = 'auth';
          errorMessage = 'Authentication failed - repository may be private or require different credentials';
        } else if (error.message.includes('Network is unreachable') || error.message.includes('Temporary failure') || error.message.includes('Connection timed out')) {
          errorCategory = 'network';
          errorMessage = 'Network error - GitHub may be rate limiting or temporarily unavailable';
        } else if (error.message.includes('Repository not found') || error.message.includes('does not exist')) {
          errorCategory = 'not_found';
          errorMessage = 'Repository not found or may have been moved/deleted';
        } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
          errorCategory = 'timeout';
          errorMessage = 'Operation timed out - repository may be too large or network is slow';
        }
        
        console.log(`Final clone failure for ${packageName}: ${errorMessage}`);
        throw new Error(`${errorMessage} (category: ${errorCategory})`);
      }
    };
    
    await cloneWithRetry();
    
    // Fetch all tags to ensure we have the version references
    try {
      // 2 minute timeout for fetching tags from large repositories
      await executeCommand('git', ['fetch', '--tags', '--force', '--unshallow'], tempDir, time_2min, `git fetch tags for ${packageName}`, false);
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
        await executeCommand('git', ['fetch', '--all'], tempDir, time_1min, `git fetch all for ${packageName}`, false); // 1 minute timeout
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
          const result = await executeCommand('git', ['rev-parse', '--verify', pattern], tempDir, time_1min, `git rev-parse ${pattern}`, false);
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
              tempDir,
              time_1min,
              `git log search for ${pattern}`,
              false
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
            tempDir,
            time_1min,
            `git log version search for ${version}`,
            false
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
        const tagsOutput = await executeCommand('git', ['tag', '-l'], tempDir, time_1min, `git tag list for ${packageName}`, false);
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
              const result = await executeCommand('git', ['rev-parse', '--verify', oldMatch], tempDir, time_1min, `git rev-parse ${oldMatch}`, false);
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
              const result = await executeCommand('git', ['rev-parse', '--verify', newMatch], tempDir, time_1min, `git rev-parse ${newMatch}`, false);
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
      console.log(`Could not find version references for ${packageName} (${oldVersion} -> ${newVersion}), using commit range fallback`);
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir, time_1min, `git rev-list first commit for ${packageName}`, false);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
        
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir, time_1min, `git rev-parse HEAD for ${packageName}`, false);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
      } catch (error) {
        console.log(`Failed to get fallback commits for ${packageName}: ${error.message}`);
        return [];
      }
    } else if (!resolvedOldRef) {
      console.log(`Could not find old version reference for ${packageName} (${oldVersion}), using first commit`);
      try {
        // Get the first commit
        const firstCommit = await executeCommand('git', ['rev-list', '--max-parents=0', 'HEAD'], tempDir, time_1min, `git rev-list first commit for ${packageName}`, false);
        resolvedOldRef = { ref: 'first-commit', hash: firstCommit.trim() };
      } catch (error) {
        console.log(`Failed to get first commit for ${packageName}: ${error.message}`);
        return [];
      }
    } else if (!resolvedNewRef) {
      console.log(`Could not find new version reference for ${packageName} (${newVersion}), using latest commit`);
      try {
        // Get the latest commit on default branch
        const latestCommit = await executeCommand('git', ['rev-parse', 'HEAD'], tempDir, time_1min, `git rev-parse HEAD for ${packageName}`, false);
        resolvedNewRef = { ref: 'latest-commit', hash: latestCommit.trim() };
      } catch (error) {
        console.log(`Failed to get latest commit for ${packageName}: ${error.message}`);
        return [];
      }
    }
    
    // Check if the order is correct (older should come before newer)
    try {
      // Try to determine which commit came first
      const mergeBase = await executeCommand(
        'git',
        ['merge-base', resolvedOldRef.hash, resolvedNewRef.hash],
        tempDir,
        time_1min,
        `git merge-base for ${packageName}`,
        false
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
      console.log(`Getting commit history for ${packageName}: ${resolvedOldRef.ref}(${resolvedOldRef.hash.substring(0, 7)}) -> ${resolvedNewRef.ref}(${resolvedNewRef.hash.substring(0, 7)})`);
      output = await executeCommand(
        'git', 
        ['log', `${resolvedOldRef.hash}..${resolvedNewRef.hash}`, '--pretty=format:%H,%an,%ad,%s'], 
        tempDir,
        time_1min,
        `git log for ${packageName}`,
        false
      );
    } catch (error) {
      console.log(`Git log range failed for ${packageName}: ${error.message}`);
      // Try with a different approach - get all commits and filter
      try {
        output = await executeCommand(
          'git',
          ['log', '--pretty=format:%H,%an,%ad,%s', '--max-count=50'],
          tempDir,
          time_1min,
          `git log recent for ${packageName}`,
          false
        );
        console.log(`Using recent commits fallback for ${packageName}`);
      } catch (e) {
        console.log(`All git log attempts failed for ${packageName}: ${e.message}`);
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
