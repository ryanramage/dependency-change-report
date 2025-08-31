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
    
    // Get all tags sorted by version (descending)
    const allTagsOutput = await executeCommand('git', ['tag', '-l', '--sort=-version:refname'], repoPath, 30000, 'getting git tags');
    const allTags = allTagsOutput.trim().split('\n').filter(tag => tag.length > 0);
    
    if (allTags.length === 0) {
      throw new Error('No git tags found in repository');
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
