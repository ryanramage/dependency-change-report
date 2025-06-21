import { join } from 'path';
import { readFile } from 'fs/promises';

/**
 * Get repository URL from package.json
 * @param {string} packageDir - Path to the package directory
 * @returns {Promise<string|null>} - Repository URL or null if not found
 */
export const getRepositoryUrl = async (packageDir) => {
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
 * Clean repository URL and convert to git URL for authentication
 * @param {string} repoUrl - Raw repository URL
 * @returns {string} - Cleaned repository URL
 */
export const cleanRepositoryUrl = (repoUrl) => {
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
  
  return cleanRepoUrl;
};
