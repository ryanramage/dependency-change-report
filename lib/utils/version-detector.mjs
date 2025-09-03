import { executeCommand } from './command-executor.mjs';

/**
 * Detects the current and previous stable versions for automatic comparison
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<{newer: string, older: string}>} The newer and older versions
 */
export const detectVersions = async (repoPath = '.') => {
  try {
    // Get current reference (from GitHub Actions environment or current HEAD)
    let currentRef = process.env.GITHUB_REF_NAME || 
                     process.env.GITHUB_SHA;
    
    if (!currentRef) {
      // Fallback to getting current branch/tag from git
      try {
        const stdout = await executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, 30000, 'getting current branch');
        currentRef = stdout.trim();
        
        // If we're in detached HEAD state, try to get tag
        if (currentRef === 'HEAD') {
          try {
            const tagOutput = await executeCommand('git', ['describe', '--tags', '--exact-match', 'HEAD'], repoPath, 30000, 'getting current tag');
            currentRef = tagOutput.trim();
          } catch {
            // If no exact tag match, use commit SHA
            const shaOutput = await executeCommand('git', ['rev-parse', 'HEAD'], repoPath, 30000, 'getting current commit');
            currentRef = shaOutput.trim().substring(0, 7);
          }
        }
      } catch (error) {
        throw new Error(`Failed to get current git reference: ${error.message}`);
      }
    }
    
    // Handle GitHub Actions pull request references
    if (process.env.GITHUB_ACTIONS === 'true') {
      // For pull requests, use the actual HEAD commit instead of GitHub's merge reference
      if (currentRef && (currentRef.includes('/merge') || currentRef.includes('/head'))) {
        try {
          const commitHash = await executeCommand('git', ['rev-parse', 'HEAD'], repoPath, 10000, 'getting PR commit hash');
          currentRef = commitHash.trim().substring(0, 7); // Use short hash
          console.log(`Converted GitHub Actions reference to commit hash: ${currentRef}`);
        } catch (error) {
          console.warn(`Warning: Could not get commit hash for PR: ${error.message}`);
        }
      }
    }
    
    // Get all tags sorted by version (descending)
    const allTagsOutput = await executeCommand('git', ['tag', '-l', '--sort=-version:refname'], repoPath, 30000, 'getting git tags');
    const allTags = allTagsOutput.trim().split('\n').filter(tag => tag.length > 0);
    
    if (allTags.length === 0) {
      console.log('No git tags found in repository, falling back to comparing against main branch');
      
      // Try to get the main branch (could be 'main' or 'master')
      let mainBranch = 'main';
      try {
        // Check if 'main' branch exists
        await executeCommand('git', ['rev-parse', '--verify', 'origin/main'], repoPath, 10000, 'checking for main branch');
      } catch {
        try {
          // Fallback to 'master' if 'main' doesn't exist
          await executeCommand('git', ['rev-parse', '--verify', 'origin/master'], repoPath, 10000, 'checking for master branch');
          mainBranch = 'master';
        } catch {
          // If neither exists, try to get the default branch
          try {
            const defaultBranchOutput = await executeCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath, 10000, 'getting default branch');
            mainBranch = defaultBranchOutput.trim().replace('refs/remotes/origin/', '');
          } catch {
            // Final fallback - just use 'main'
            mainBranch = 'main';
          }
        }
      }
      
      console.log(`Auto-detected versions:`);
      console.log(`  Current (newer): ${currentRef}`);
      console.log(`  Main branch (older): ${mainBranch}`);
      
      return {
        newer: currentRef,
        older: mainBranch
      };
    }
    
    // Filter out pre-release tags (containing -rc, -beta, -alpha, -pre, -dev)
    const stableTags = allTags.filter(tag => 
      !tag.match(/-rc\d*|-beta|-alpha|-pre|-dev/i)
    );
    
    if (stableTags.length === 0) {
      throw new Error('No stable release tags found (all tags appear to be pre-releases)');
    }
    
    // Get the latest stable tag
    const latestStable = stableTags[0];
    
    console.log(`Auto-detected versions:`);
    console.log(`  Current (newer): ${currentRef}`);
    console.log(`  Latest stable (older): ${latestStable}`);
    
    return {
      newer: currentRef,
      older: latestStable
    };
    
  } catch (error) {
    throw new Error(`Failed to auto-detect versions: ${error.message}`);
  }
};
