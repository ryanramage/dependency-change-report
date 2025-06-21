import { join } from 'path';
import { readFile } from 'fs/promises';

/**
 * Check if package-lock.json exists and get dependency changes from it
 * @param {string} olderVersionDir - Directory of older version
 * @param {string} newerVersionDir - Directory of newer version
 * @returns {Promise<Object>} - Object with changed packages and their version info
 */
export const getPackageLockChanges = async (olderVersionDir, newerVersionDir) => {
  try {
    const oldLockPath = join(olderVersionDir, 'package-lock.json');
    const newLockPath = join(newerVersionDir, 'package-lock.json');
    
    // Check if both files exist
    try {
      await readFile(oldLockPath);
      await readFile(newLockPath);
    } catch (error) {
      return { changedPackages: [], packageVersions: {} };
    }
    
    // Read and parse both lock files
    const oldLock = JSON.parse(await readFile(oldLockPath, 'utf8'));
    const newLock = JSON.parse(await readFile(newLockPath, 'utf8'));
    
    // Extract all packages from lock files
    const oldPackages = extractPackagesFromLock(oldLock);
    const newPackages = extractPackagesFromLock(newLock);
    
    // Find packages that changed, were added, or were removed
    const changedPackages = new Set();
    const packageVersions = {};
    
    // Check for added and changed packages
    for (const [name, newInfo] of Object.entries(newPackages)) {
      if (!oldPackages[name]) {
        // Package was added
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: null,
          newVersion: newInfo.version,
          changeType: 'added'
        };
      } else if (oldPackages[name].version !== newInfo.version) {
        // Package version changed
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: oldPackages[name].version,
          newVersion: newInfo.version,
          changeType: 'upgraded'
        };
      }
    }
    
    // Check for removed packages
    for (const [name, oldInfo] of Object.entries(oldPackages)) {
      if (!newPackages[name]) {
        // Package was removed
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: oldInfo.version,
          newVersion: null,
          changeType: 'removed'
        };
      }
    }
    
    return { 
      changedPackages: Array.from(changedPackages), 
      packageVersions 
    };
    
  } catch (error) {
    return { changedPackages: [], packageVersions: {} };
  }
};

/**
 * Extract all packages from a package-lock.json structure
 * @param {Object} lockData - Parsed package-lock.json data
 * @returns {Object} - Map of package names to their info
 */
export const extractPackagesFromLock = (lockData) => {
  const packages = {};
  
  // Handle both lockfileVersion 1 and 2+ formats
  if (lockData.lockfileVersion >= 2 && lockData.packages) {
    // Version 2+ format uses "packages" field
    for (const [path, info] of Object.entries(lockData.packages)) {
      if (path === '') continue; // Skip root package
      
      // Extract package name from path (remove node_modules prefix)
      const name = path.replace(/^node_modules\//, '');
      if (info.version) {
        packages[name] = {
          version: info.version,
          resolved: info.resolved,
          integrity: info.integrity
        };
      }
    }
  } else if (lockData.dependencies) {
    // Version 1 format uses "dependencies" field
    extractFromDependencies(lockData.dependencies, packages);
  }
  
  return packages;
};

/**
 * Recursively extract packages from dependencies object (lockfile v1 format)
 * @param {Object} dependencies - Dependencies object
 * @param {Object} packages - Accumulator for packages
 */
export const extractFromDependencies = (dependencies, packages) => {
  for (const [name, info] of Object.entries(dependencies)) {
    if (info.version) {
      packages[name] = {
        version: info.version,
        resolved: info.resolved,
        integrity: info.integrity
      };
    }
    
    // Recursively process nested dependencies
    if (info.dependencies) {
      extractFromDependencies(info.dependencies, packages);
    }
  }
};
