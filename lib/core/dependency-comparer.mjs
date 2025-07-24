import semver from 'semver';

/**
 * Compare dependencies between two versions
 * @param {Object} oldDeps - Old dependencies
 * @param {Object} newDeps - New dependencies
 * @param {Object} packageVersions - Package version info with devDep data from package-lock parser
 * @returns {Object} - Comparison result
 */
export const compareDependencies = (oldDeps, newDeps, packageVersions = {}) => {
  const added = [];
  const removed = [];
  const upgraded = [];
  const modified = [];

  // Track packages that might have changed namespaces
  const potentialNamespaceChanges = new Map();
  
  // Helper function to get the base name without namespace
  const getBaseName = (name) => {
    return name.includes('/') ? name.split('/').pop() : name;
  };
  
  // Helper function to check if a name is namespaced
  const isNamespaced = (name) => name.includes('/');

  // First pass: Find added and upgraded dependencies
  for (const [name, info] of Object.entries(newDeps)) {
    if (!oldDeps[name]) {
      // Store potentially renamed packages for later processing
      const baseName = getBaseName(name);
      potentialNamespaceChanges.set(baseName, {
        newName: name,
        newVersion: info.version,
        repository: info.repository || null,
        type: 'added'
      });
    } else if (oldDeps[name].version !== info.version) {
      const oldVersion = oldDeps[name].version;
      const newVersion = info.version;
      
      let changeType = 'unknown';
      try {
        if (semver.valid(oldVersion) && semver.valid(newVersion)) {
          if (semver.major(newVersion) > semver.major(oldVersion)) {
            changeType = 'major';
          } else if (semver.minor(newVersion) > semver.minor(oldVersion)) {
            changeType = 'minor';
          } else if (semver.patch(newVersion) > semver.patch(oldVersion)) {
            changeType = 'patch';
          }
        }
      } catch (error) {
        // Silently continue with unknown change type
      }

      upgraded.push({
        name,
        oldVersion,
        newVersion,
        changeType,
        repository: info.repository || null,
        devDep: packageVersions[name]?.devDep || false
      });
    }
  }

  // Second pass: Find removed dependencies and check for namespace changes
  for (const [name, info] of Object.entries(oldDeps)) {
    if (!newDeps[name]) {
      const baseName = getBaseName(name);
      
      // Check if this might be a namespace change
      if (potentialNamespaceChanges.has(baseName)) {
        const match = potentialNamespaceChanges.get(baseName);
        
        // This is likely a namespace change (e.g., pkg -> @org/pkg or vice versa)
        modified.push({
          oldName: name,
          newName: match.newName,
          oldVersion: info.version,
          newVersion: match.newVersion,
          changeType: 'namespace',
          devDep: packageVersions[match.newName]?.devDep || packageVersions[name]?.devDep || false
        });
        
        // Remove from potential namespace changes to avoid double-counting
        potentialNamespaceChanges.delete(baseName);
      } else {
        // Store potentially renamed packages for later processing
        potentialNamespaceChanges.set(baseName, {
          oldName: name,
          oldVersion: info.version,
          type: 'removed'
        });
      }
    }
  }
  
  // Process remaining potential namespace changes
  for (const [baseName, data] of potentialNamespaceChanges.entries()) {
    if (data.type === 'added') {
      added.push({ 
        name: data.newName, 
        version: data.newVersion,
        repository: data.repository,
        devDep: packageVersions[data.newName]?.devDep || false
      });
    } else if (data.type === 'removed') {
      removed.push({ 
        name: data.oldName, 
        version: data.oldVersion,
        devDep: packageVersions[data.oldName]?.devDep || false
      });
    }
  }

  // Compare nested dependencies if they exist
  const nestedAdded = [];
  const nestedRemoved = [];
  const nestedUpgraded = [];
  const nestedModified = [];
  
  // Helper function to process nested dependencies
  const processNestedDependencies = (oldParent, newParent, parentName) => {
    if (!oldParent || !newParent) return;
    
    const oldNestedDeps = oldParent.dependencies || {};
    const newNestedDeps = newParent.dependencies || {};
    
    // Compare nested dependencies
    for (const [name, info] of Object.entries(newNestedDeps)) {
      if (!oldNestedDeps[name]) {
        nestedAdded.push({ 
          name, 
          version: info.version,
          repository: info.repository,
          parent: parentName,
          devDep: packageVersions[name]?.devDep || false
        });
      } else if (oldNestedDeps[name].version !== info.version) {
        const oldVersion = oldNestedDeps[name].version;
        const newVersion = info.version;
        
        let changeType = 'unknown';
        try {
          if (semver.valid(oldVersion) && semver.valid(newVersion)) {
            if (semver.major(newVersion) > semver.major(oldVersion)) {
              changeType = 'major';
            } else if (semver.minor(newVersion) > semver.minor(oldVersion)) {
              changeType = 'minor';
            } else if (semver.patch(newVersion) > semver.patch(oldVersion)) {
              changeType = 'patch';
            }
          }
        } catch (error) {
          // Silently continue with unknown change type
        }

        nestedUpgraded.push({
          name,
          oldVersion,
          newVersion,
          changeType,
          repository: info.repository,
          parent: parentName,
          devDep: packageVersions[name]?.devDep || false
        });
      }
    }
    
    // Find removed nested dependencies
    for (const [name, info] of Object.entries(oldNestedDeps)) {
      if (!newNestedDeps[name]) {
        nestedRemoved.push({ 
          name, 
          version: info.version,
          parent: parentName,
          devDep: packageVersions[name]?.devDep || false
        });
      }
    }
  };
  
  // Process nested dependencies for each top-level dependency
  for (const [name, info] of Object.entries(newDeps)) {
    if (oldDeps[name] && info.dependencies) {
      processNestedDependencies(oldDeps[name], info, name);
    }
  }
  
  return { 
    added, 
    removed, 
    upgraded, 
    modified,
    nested: {
      added: nestedAdded,
      removed: nestedRemoved,
      upgraded: nestedUpgraded,
      modified: nestedModified
    }
  };
};
