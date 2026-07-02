import { basename, join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { executeCommand, time_10min, time_5min, time_2min, time_1min } from '../utils/command-executor.mjs';
import { registerTempDir, unregisterTempDir } from '../utils/cleanup-manager.mjs';

/**
 * Clone a GitHub repository at a specific reference
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} ref - Git reference (tag, branch, commit)
 * @param {string} targetDir - Directory to clone into
 * @param {boolean} enablePeriodicLogging - Whether to enable periodic logging for long operations
 * @returns {Promise<void>}
 */
export const cloneRepo = async (repoUrl, ref, targetDir, enablePeriodicLogging = false, options = {}) => {
  const { shallow = true } = options;
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

  // Shallow single-branch clone is fastest, but only holds one ref. For
  // multi-ref analysis (needing both a baseline and current ref) callers pass
  // { shallow: false } to get a full clone with all history/tags.
  if (shallow && ref) {
    try {
      // Use --quiet to avoid printing credentials in logs
      // 2 minute timeout for very large repositories
      await executeCommand('git', ['clone', '--quiet', '--depth=1', '--single-branch', '--branch', ref, authenticatedRepoUrl, targetDir], undefined, time_2min, `git clone of ${repoName} (${ref})`, enablePeriodicLogging);
      return;
    } catch (error) {
      // Fall through to a full clone below
    }
  }

  // Blobless partial clone: fetches all commits/tags/trees but no historical
  // file blobs (those are fetched on demand at checkout). Much faster and
  // smaller for large repos than a full clone, while still exposing every ref
  // so the analyzer can worktree both the baseline and current versions.
  await executeCommand('git', ['clone', '--quiet', '--filter=blob:none', authenticatedRepoUrl, targetDir], undefined, time_10min, `git clone of ${repoName} (blobless)`, enablePeriodicLogging);
  if (ref) {
    await executeCommand('git', ['checkout', ref], targetDir, time_5min, `git checkout ${ref}`, enablePeriodicLogging);
  }
};

// Counter so per-call (uncached) clone dirs are unique — avoids two concurrent
// clones of the same-basename repo racing on one directory.
let historyCloneCounter = 0;

const authenticateGitHubUrl = (repoUrl) => {
  const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
  if (isGitHubActions && repoUrl.startsWith('https://github.com/')) {
    const token = process.env.GITHUB_TOKEN;
    if (token) return repoUrl.replace('https://github.com/', `https://${token}:x-oauth-basic@github.com/`);
  }
  return repoUrl;
};

const categorizeCloneError = (message = '') => {
  if (/Authentication failed|Permission denied/.test(message)) return { category: 'auth', message: 'Authentication failed - repository may be private or require different credentials' };
  if (/Network is unreachable|Temporary failure|Connection timed out|Could not resolve host/.test(message)) return { category: 'network', message: 'Network error - host unreachable or rate limited' };
  if (/Repository not found|does not exist|not found/i.test(message)) return { category: 'not_found', message: 'Repository not found or may have been moved/deleted' };
  if (/timeout|timed out/.test(message)) return { category: 'timeout', message: 'Operation timed out - repository may be too large or network is slow' };
  return { category: 'unknown', message };
};

const sanitizeForDir = (s) => s.replace(/[^a-zA-Z0-9._-]/g, '-');

// Fail-fast validate + blobless clone (with one full-clone fallback) into targetDir.
const cloneRepoForHistory = async (repoUrl, targetDir, packageName) => {
  const authUrl = authenticateGitHubUrl(repoUrl);
  await mkdir(targetDir, { recursive: true });
  registerTempDir(targetDir);
  // Fail fast: a bad/unreachable URL fails here in ~1s, not after a clone timeout.
  await executeCommand('git', ['ls-remote', '--heads', '--tags', authUrl], undefined, 45000, `git ls-remote ${packageName}`, false);
  try {
    // Blobless partial clone: full commit graph + tags, no file blobs, so every
    // tag's commit is present (version ranges resolve) — fast and small.
    await executeCommand('git', ['clone', '--quiet', '--filter=blob:none', authUrl, targetDir], undefined, time_5min, `git clone (blobless) of ${packageName}`, false);
  } catch (error) {
    // Fallback: plain full clone (in case the remote rejects partial clone).
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(targetDir, { recursive: true });
    await executeCommand('git', ['clone', '--quiet', authUrl, targetDir], undefined, time_5min, `git clone (full) of ${packageName}`, false);
  }
  return targetDir;
};

// Get a clone dir for a repo. When cloneCache is provided, clones are deduped
// by repo URL — the first request for a repo clones it once and concurrent/later
// requests await that same clone (this also eliminates the same-dir race that
// caused "invalid index-pack output"). Returns { dir, owns } — owns=true means
// the caller must delete it (uncached, per-call clone).
const acquireCloneDir = async (repoUrl, reposDir, cloneCache) => {
  const packageName = basename(repoUrl, '.git');
  if (cloneCache) {
    if (!cloneCache.has(repoUrl)) {
      const dir = join(reposDir, 'changelog-cache', sanitizeForDir(repoUrl));
      cloneCache.set(repoUrl, cloneRepoForHistory(repoUrl, dir, packageName));
    }
    return { dir: await cloneCache.get(repoUrl), owns: false };
  }
  const dir = join(reposDir, `${packageName}-history-${++historyCloneCounter}`);
  await cloneRepoForHistory(repoUrl, dir, packageName);
  return { dir, owns: true };
};

/**
 * Get commit history between two versions
 * @param {string} repoUrl - Repository URL
 * @param {string} oldVersion - Old version
 * @param {string} newVersion - New version
 * @param {string} reposDir - Repository directory
 * @param {Object} [options] - { directory, cloneCache }
 * @returns {Promise<Array>} - Array of commit objects
 */
export const getCommitHistory = async (repoUrl, oldVersion, newVersion, reposDir, options = {}) => {
  const { directory = null, cloneCache = null } = options;
  const packageName = basename(repoUrl, '.git');
  let tempDir = null;
  let ownsClone = false;

  // Acquire the clone (deduped when a cache is provided). Remote/clone failures
  // here propagate to the caller, which categorizes them.
  try {
    const acquired = await acquireCloneDir(repoUrl, reposDir, cloneCache);
    tempDir = acquired.dir;
    ownsClone = acquired.owns;
  } catch (error) {
    const { category, message } = categorizeCloneError(error.message);
    throw new Error(`${message} (category: ${category})`);
  }

  try {
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
        
        // Look for version in package.json changes. Note: no `-p` — with a
        // patch the output would be `<hash>\n\n<diff>`, and using that as the
        // commit hash corrupts the range (git: "invalid object name") and leaks
        // repo file contents into the logs. We only want the hash.
        try {
          const result = await executeCommand(
            'git',
            ['log', '--all', '-G', `"version":\\s*"${version}"`, '--format=%H', '-n', '1'],
            tempDir,
            time_1min,
            `git log version search for ${version}`,
            false
          );

          const hash = result.trim().split('\n')[0].trim();
          if (hash) {
            return { ref: version, hash };
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
      const scope = directory ? ` (dir: ${directory})` : '';
      console.log(`Getting commit history for ${packageName}: ${resolvedOldRef.ref}(${resolvedOldRef.hash.substring(0, 7)}) -> ${resolvedNewRef.ref}(${resolvedNewRef.hash.substring(0, 7)})${scope}`);
      // Scope the log to the package's subdirectory for monorepo packages.
      const logArgs = ['log', `${resolvedOldRef.hash}..${resolvedNewRef.hash}`, '--pretty=format:%H,%an,%ad,%s'];
      if (directory) logArgs.push('--', directory);
      output = await executeCommand('git', logArgs, tempDir, time_1min, `git log for ${packageName}`, false);
    } catch (error) {
      // Range genuinely couldn't be computed. Return empty (surfaced as a "no
      // commits" error) rather than a misleading "recent 50 commits" fallback.
      // Log only the first line so a command's stdout (e.g. a diff) can't leak
      // repo contents into the logs.
      const firstLine = String(error.message || '').split('\n')[0];
      console.log(`Git log range failed for ${packageName}: ${firstLine}`);
      return [];
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
    
    return commits;
  } catch (error) {
    // Repo cloned fine but the range couldn't be computed — return empty
    // (surfaced as a "no commits" error) rather than misleading data.
    return [];
  } finally {
    // Only delete clones we own. Shared (cached) clones are reused by other
    // dependencies from the same repo and are cleaned up with reposDir.
    if (tempDir && ownsClone) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        unregisterTempDir(tempDir);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }
};
