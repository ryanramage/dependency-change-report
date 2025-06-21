import https from 'https';

/**
 * Make a request to GitHub API
 * @param {string} url - API URL
 * @returns {Promise<Object>} - API response data
 */
export const makeGitHubApiRequest = (url) => {
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
 * Get GitHub Actions status for a specific commit/tag
 * @param {string} repoUrl - Repository URL
 * @param {string} version - Version/tag to check
 * @param {string} commitSha - Optional commit SHA if already known
 * @returns {Promise<Object|null>} - GitHub Actions status or null
 */
export const getGitHubActionsStatus = async (repoUrl, version, commitSha = null) => {
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
