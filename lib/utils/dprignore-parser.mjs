import { readFile } from 'fs/promises';
import { join } from 'path';
import { minimatch } from 'minimatch';

/**
 * Parse a .dcrignore file and return patterns and exact matches
 * @param {string} filePath - Path to the .dcrignore file
 * @returns {Promise<Object>} - Object with exactMatches Set and patterns Array
 */
export const parseDcrIgnoreFile = async (filePath) => {
  const exactMatches = new Set();
  const patterns = [];
  
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
      
      // Check if this is a glob pattern (contains *, ?, [, or ])
      if (trimmedLine.includes('*') || trimmedLine.includes('?') || 
          trimmedLine.includes('[') || trimmedLine.includes(']')) {
        patterns.push(trimmedLine);
      } else {
        // Exact match
        exactMatches.add(trimmedLine);
      }
    }
  } catch (error) {
    // File doesn't exist or can't be read - return empty structures
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Could not read .dcrignore file: ${error.message}`);
    }
  }
  
  return { exactMatches, patterns };
};

/**
 * Check if a package name should be ignored based on exact matches and patterns
 * @param {string} packageName - Package name to check
 * @param {Set<string>} exactMatches - Set of exact package names to ignore
 * @param {Array<string>} patterns - Array of glob patterns to match against
 * @returns {boolean} - True if package should be ignored
 */
export const shouldIgnorePackage = (packageName, exactMatches, patterns) => {
  // Check exact matches first (faster)
  if (exactMatches.has(packageName)) {
    return true;
  }
  
  // Check glob patterns
  for (const pattern of patterns) {
    if (minimatch(packageName, pattern)) {
      return true;
    }
  }
  
  return false;
};

/**
 * Read .dcrignore from the current directory (repository root)
 * @param {string} repoDir - Repository directory (should be current working directory)
 * @returns {Promise<Object>} - Object with exactMatches Set and patterns Array
 */
export const getDcrIgnoreList = async (repoDir) => {
  const dcrignorePath = join(repoDir, '.dcrignore');
  return await parseDcrIgnoreFile(dcrignorePath);
};
