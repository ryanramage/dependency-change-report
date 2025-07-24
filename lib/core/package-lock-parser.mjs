import { join } from 'path';
import { readFile } from 'fs/promises';

/**
 * Parse package.json to get dev dependencies
 * @param {string} versionDir - Directory containing package.json
 * @returns {Promise<Set>} - Set of dev dependency names
 */
export const getDevDependencies = async (versionDir) => {
  try {
    const packageJsonPath = join(versionDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    return new Set(Object.keys(packageJson.devDependencies || {}));
  } catch (error) {
    return new Set();
  }
};

/**
 * Build dependency graph from package-lock.json
 * @param {Object} lockData - Parsed package-lock.json data
 * @returns {Object} - Dependency graph with parent-child relationships
 */
export const buildDependencyGraph = (lockData) => {
  const graph = {
    // Map of package name to its direct parents
    parents: new Map(),
    // Map of package name to its direct children
    children: new Map(),
    // Set of top-level dependencies
    topLevel: new Set()
  };

  if (lockData.lockfileVersion >= 2 && lockData.packages) {
    // Version 2+ format
    for (const [path, info] of Object.entries(lockData.packages)) {
      if (path === '') {
        // Root package - track its direct dependencies as top-level
        if (info.dependencies) {
          for (const depName of Object.keys(info.dependencies)) {
            graph.topLevel.add(depName);
          }
        }
        if (info.devDependencies) {
          for (const depName of Object.keys(info.devDependencies)) {
            graph.topLevel.add(depName);
          }
        }
        continue;
      }

      // Extract package name from path
      const packageName = path.replace(/^node_modules\//, '');
      
      // Initialize maps for this package
      if (!graph.parents.has(packageName)) {
        graph.parents.set(packageName, new Set());
      }
      if (!graph.children.has(packageName)) {
        graph.children.set(packageName, new Set());
      }

      // Determine parent from path structure
      const pathParts = path.split('/node_modules/');
      if (pathParts.length === 2) {
        // This is a top-level dependency (node_modules/package-name)
        // Parent is root, already handled above
      } else if (pathParts.length > 2) {
        // This is a nested dependency (node_modules/parent/node_modules/child)
        const parentPath = pathParts.slice(0, -1).join('/node_modules/');
        const parentName = parentPath.replace(/^node_modules\//, '');
        
        // Add parent-child relationship
        graph.parents.get(packageName).add(parentName);
        if (!graph.children.has(parentName)) {
          graph.children.set(parentName, new Set());
        }
        graph.children.get(parentName).add(packageName);
      }
    }
  } else if (lockData.dependencies) {
    // Version 1 format - build from dependencies structure
    const processRootDeps = (deps) => {
      for (const depName of Object.keys(deps)) {
        graph.topLevel.add(depName);
      }
    };
    
    if (lockData.dependencies) {
      processRootDeps(lockData.dependencies);
    }
    
    buildGraphFromDependencies(lockData.dependencies, graph, null);
  }

  return graph;
};

/**
 * Recursively build dependency graph from dependencies object (lockfile v1 format)
 * @param {Object} dependencies - Dependencies object
 * @param {Object} graph - Graph object to populate
 * @param {string} parentName - Name of parent package (null for root level)
 */
const buildGraphFromDependencies = (dependencies, graph, parentName) => {
  for (const [name, info] of Object.entries(dependencies)) {
    // Initialize maps for this package
    if (!graph.parents.has(name)) {
      graph.parents.set(name, new Set());
    }
    if (!graph.children.has(name)) {
      graph.children.set(name, new Set());
    }

    // Add parent-child relationship
    if (parentName !== null) {
      graph.parents.get(name).add(parentName);
      if (!graph.children.has(parentName)) {
        graph.children.set(parentName, new Set());
      }
      graph.children.get(parentName).add(name);
    }

    // Recursively process nested dependencies
    if (info.dependencies) {
      buildGraphFromDependencies(info.dependencies, graph, name);
    }
  }
};

/**
 * Check if a package is only used as a development dependency
 * @param {string} packageName - Name of the package
 * @param {Object} dependencyGraph - Dependency graph
 * @param {Set} devDependencies - Set of top-level dev dependencies
 * @returns {boolean} - True if package is only used for development
 */
export const isDevOnlyDependency = (packageName, dependencyGraph, devDependencies) => {
  // If it's a top-level dependency, check if it's in devDependencies
  if (dependencyGraph.topLevel.has(packageName)) {
    const isDevDep = devDependencies.has(packageName);
    console.log(`DEBUG: ${packageName} is top-level, devDep: ${isDevDep}`);
    return isDevDep;
  }

  // For nested dependencies, find all paths to root
  const allPaths = findAllPathsToRoot(packageName, dependencyGraph);
  
  // If no paths found, assume it's not dev-only
  if (allPaths.length === 0) {
    console.log(`DEBUG: ${packageName} has no paths to root`);
    return false;
  }

  console.log(`DEBUG: ${packageName} paths:`, allPaths.map(path => path.join(' -> ')));
  
  // Check if ALL paths start with a dev dependency
  const isDevOnly = allPaths.every(path => {
    const topLevelDep = path[path.length - 1]; // Last item is closest to root
    const isDevPath = devDependencies.has(topLevelDep);
    console.log(`DEBUG: ${packageName} path ${path.join(' -> ')}, top-level: ${topLevelDep}, isDevPath: ${isDevPath}`);
    return isDevPath;
  });
  
  console.log(`DEBUG: ${packageName} final devDep result: ${isDevOnly}`);
  return isDevOnly;
};

/**
 * Find all paths from a package to root dependencies
 * @param {string} packageName - Name of the package
 * @param {Object} dependencyGraph - Dependency graph
 * @returns {Array<Array<string>>} - Array of paths (each path is array of package names)
 */
const findAllPathsToRoot = (packageName, dependencyGraph) => {
  const paths = [];
  const visited = new Set();

  const dfs = (currentPackage, currentPath) => {
    if (visited.has(currentPackage)) {
      return; // Avoid cycles
    }

    visited.add(currentPackage);
    const parents = dependencyGraph.parents.get(currentPackage);

    if (!parents || parents.size === 0) {
      // This is a root dependency
      if (dependencyGraph.topLevel.has(currentPackage)) {
        paths.push([...currentPath, currentPackage]);
      }
    } else {
      // Continue up the tree
      for (const parent of parents) {
        dfs(parent, [...currentPath, currentPackage]);
      }
    }

    visited.delete(currentPackage);
  };

  dfs(packageName, []);
  return paths;
};

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
    
    // Get dev dependencies from both versions
    const oldDevDeps = await getDevDependencies(olderVersionDir);
    const newDevDeps = await getDevDependencies(newerVersionDir);
    
    // Build dependency graphs
    const oldGraph = buildDependencyGraph(oldLock);
    const newGraph = buildDependencyGraph(newLock);
    
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
          changeType: 'added',
          devDep: isDevOnlyDependency(name, newGraph, newDevDeps)
        };
      } else if (oldPackages[name].version !== newInfo.version) {
        // Package version changed
        changedPackages.add(name);
        packageVersions[name] = {
          oldVersion: oldPackages[name].version,
          newVersion: newInfo.version,
          changeType: 'upgraded',
          devDep: isDevOnlyDependency(name, newGraph, newDevDeps)
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
          changeType: 'removed',
          devDep: isDevOnlyDependency(name, oldGraph, oldDevDeps)
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
