import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Parse a .dcrignore file and return a set of package names to ignore
 * @param {string} filePath - Path to the .dcrignore file
 * @returns {Promise<Set<string>>} - Set of package names to ignore
 */
export const parseDcrIgnoreFile = async (filePath) => {
  const ignoredPackages = new Set();
  
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Remove comments and trim whitespace
      const trimmedLine = line.split('#')[0].trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        continue;
      }
      
      // Add the package name to the set
      ignoredPackages.add(trimmedLine);
    }
  } catch (error) {
    // File doesn't exist or can't be read - return empty set
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Could not read .dcrignore file: ${error.message}`);
    }
  }
  
  return ignoredPackages;
};

/**
 * Read .dcrignore from the current directory (repository root)
 * @param {string} repoDir - Repository directory (should be current working directory)
 * @returns {Promise<Set<string>>} - Set of package names to ignore
 */
export const getDcrIgnoreList = async (repoDir) => {
  const dcrignorePath = join(repoDir, '.dcrignore');
  return await parseDcrIgnoreFile(dcrignorePath);
};
