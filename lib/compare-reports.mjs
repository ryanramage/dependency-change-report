import { readFile } from 'fs/promises';
import { minimatch } from 'minimatch';

/**
 * @typedef {Object} CompareOptions
 * @property {string[]} [excludePatterns] - Glob patterns to exclude from comparison
 * @property {string[]} [includePatterns] - Glob patterns to include (only these are compared)
 * @property {boolean} [ignoreDev] - Exclude devDependencies from comparison
 * @property {boolean} [includeNested] - Include nested/transitive dependencies
 */

/**
 * @typedef {Object} DiscrepancyItem
 * @property {string} name - Package name
 * @property {string} category - Category of discrepancy
 * @property {string} severity - high | medium | low
 */

/**
 * Load and parse a report.json file
 * @param {string} jsonPath - Path to report.json
 * @returns {Promise<Object>} - Parsed report object
 */
const loadReport = async (jsonPath) => {
  try {
    const content = await readFile(jsonPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Report file not found: ${jsonPath}`);
    }
    throw new Error(`Failed to parse report file ${jsonPath}: ${error.message}`);
  }
};

/**
 * Check if a package name matches any of the given glob patterns
 * @param {string} name - Package name
 * @param {string[]} patterns - Glob patterns
 * @returns {boolean}
 */
const matchesAnyPattern = (name, patterns) => {
  return patterns.some(pattern => minimatch(name, pattern));
};

/**
 * Determine severity for a discrepancy
 * @param {string} category - Discrepancy category
 * @param {Object} [details] - Additional details for severity calculation
 * @returns {string} - high | medium | low
 */
const determineSeverity = (category, details = {}) => {
  switch (category) {
    case 'added_only_in_project1':
    case 'added_only_in_project2':
      return 'high';
    case 'removed_only_in_project1':
    case 'removed_only_in_project2':
      return 'medium';
    case 'version_mismatch':
      // Major version mismatch is high severity
      if (details.project1?.changeType === 'major' || details.project2?.changeType === 'major') {
        return 'high';
      }
      if (details.project1?.changeType === 'minor' || details.project2?.changeType === 'minor') {
        return 'medium';
      }
      return 'low';
    case 'upgrade_only_in_project1':
    case 'upgrade_only_in_project2':
      if (details.changeType === 'major') return 'high';
      if (details.changeType === 'minor') return 'medium';
      return 'low';
    default:
      return 'medium';
  }
};

/**
 * Filter a list of dependency changes based on options
 * @param {Array} deps - Array of dependency objects
 * @param {CompareOptions} options - Filter options
 * @param {Array} filteredOut - Array to push filtered items into (for tracking)
 * @returns {Array} - Filtered dependencies
 */
const filterDeps = (deps, options, filteredOut = []) => {
  if (!deps) return [];
  return deps.filter(dep => {
    const name = dep.name || dep.oldName || dep.newName;

    // Filter devDeps
    if (options.ignoreDev && dep.devDep) {
      filteredOut.push({ name, reason: 'devDependency (--ignore-dev)' });
      return false;
    }

    // Filter by exclude patterns
    if (options.excludePatterns && options.excludePatterns.length > 0) {
      if (matchesAnyPattern(name, options.excludePatterns)) {
        const matchedPattern = options.excludePatterns.find(p => minimatch(name, p));
        filteredOut.push({ name, reason: `matched exclude pattern: ${matchedPattern}` });
        return false;
      }
    }

    // Filter by include patterns (only keep matching)
    if (options.includePatterns && options.includePatterns.length > 0) {
      if (!matchesAnyPattern(name, options.includePatterns)) {
        filteredOut.push({ name, reason: 'did not match any include pattern' });
        return false;
      }
    }

    return true;
  });
};

/**
 * Build a Map of dependencies keyed by name for quick lookup
 * @param {Array} deps - Array of dependency objects
 * @returns {Map<string, Object>}
 */
const buildLookup = (deps) => {
  const map = new Map();
  for (const dep of deps) {
    const name = dep.name || dep.newName;
    map.set(name, dep);
  }
  return map;
};

/**
 * Compare two dependency change reports
 * @param {Object} report1 - First project report (parsed JSON)
 * @param {Object} report2 - Second project report (parsed JSON)
 * @param {CompareOptions} options - Comparison options
 * @returns {Object} - Comparison result
 */
const compareReportData = (report1, report2, options = {}) => {
  const filtered = [];

  // Extract and filter changes from both reports
  const p1Added = filterDeps(report1.changes.added || [], options, filtered);
  const p2Added = filterDeps(report2.changes.added || [], options, filtered);
  const p1Removed = filterDeps(report1.changes.removed || [], options, filtered);
  const p2Removed = filterDeps(report2.changes.removed || [], options, filtered);
  const p1Upgraded = filterDeps(report1.changes.upgraded || [], options, filtered);
  const p2Upgraded = filterDeps(report2.changes.upgraded || [], options, filtered);
  const p1Modified = filterDeps(report1.changes.modified || [], options, filtered);
  const p2Modified = filterDeps(report2.changes.modified || [], options, filtered);

  // Build lookup maps
  const p1AddedMap = buildLookup(p1Added);
  const p2AddedMap = buildLookup(p2Added);
  const p1RemovedMap = buildLookup(p1Removed);
  const p2RemovedMap = buildLookup(p2Removed);
  const p1UpgradedMap = buildLookup(p1Upgraded);
  const p2UpgradedMap = buildLookup(p2Upgraded);
  const p1ModifiedMap = buildLookup(p1Modified);
  const p2ModifiedMap = buildLookup(p2Modified);

  // --- Cross-reference additions ---
  const addedOnlyInProject1 = [];
  const addedOnlyInProject2 = [];
  const matchingAdded = [];

  for (const [name, dep] of p1AddedMap) {
    if (p2AddedMap.has(name)) {
      const p2Dep = p2AddedMap.get(name);
      matchingAdded.push({
        name,
        project1: { version: dep.version },
        project2: { version: p2Dep.version },
        versionsMatch: dep.version === p2Dep.version
      });
    } else {
      addedOnlyInProject1.push({
        name,
        version: dep.version,
        repository: dep.repository || null,
        category: 'added_only_in_project1',
        severity: determineSeverity('added_only_in_project1')
      });
    }
  }

  for (const [name, dep] of p2AddedMap) {
    if (!p1AddedMap.has(name)) {
      addedOnlyInProject2.push({
        name,
        version: dep.version,
        repository: dep.repository || null,
        category: 'added_only_in_project2',
        severity: determineSeverity('added_only_in_project2')
      });
    }
  }

  // --- Cross-reference removals ---
  const removedOnlyInProject1 = [];
  const removedOnlyInProject2 = [];
  const matchingRemoved = [];

  for (const [name, dep] of p1RemovedMap) {
    if (p2RemovedMap.has(name)) {
      matchingRemoved.push({
        name,
        project1: { version: dep.version },
        project2: { version: p2RemovedMap.get(name).version }
      });
    } else {
      removedOnlyInProject1.push({
        name,
        version: dep.version,
        category: 'removed_only_in_project1',
        severity: determineSeverity('removed_only_in_project1')
      });
    }
  }

  for (const [name, dep] of p2RemovedMap) {
    if (!p1RemovedMap.has(name)) {
      removedOnlyInProject2.push({
        name,
        version: dep.version,
        category: 'removed_only_in_project2',
        severity: determineSeverity('removed_only_in_project2')
      });
    }
  }

  // --- Cross-reference upgrades ---
  const versionMismatch = [];
  const upgradeOnlyInProject1 = [];
  const upgradeOnlyInProject2 = [];
  const matchingUpgraded = [];

  for (const [name, dep] of p1UpgradedMap) {
    if (p2UpgradedMap.has(name)) {
      const p2Dep = p2UpgradedMap.get(name);
      if (dep.newVersion === p2Dep.newVersion && dep.oldVersion === p2Dep.oldVersion) {
        matchingUpgraded.push({
          name,
          project1: { oldVersion: dep.oldVersion, newVersion: dep.newVersion, changeType: dep.changeType },
          project2: { oldVersion: p2Dep.oldVersion, newVersion: p2Dep.newVersion, changeType: p2Dep.changeType }
        });
      } else {
        const details = {
          project1: { changeType: dep.changeType },
          project2: { changeType: p2Dep.changeType }
        };
        versionMismatch.push({
          name,
          project1: {
            oldVersion: dep.oldVersion,
            newVersion: dep.newVersion,
            changeType: dep.changeType,
            repository: dep.repository || null
          },
          project2: {
            oldVersion: p2Dep.oldVersion,
            newVersion: p2Dep.newVersion,
            changeType: p2Dep.changeType,
            repository: p2Dep.repository || null
          },
          category: 'version_mismatch',
          severity: determineSeverity('version_mismatch', details)
        });
      }
    } else {
      upgradeOnlyInProject1.push({
        name,
        project1: {
          oldVersion: dep.oldVersion,
          newVersion: dep.newVersion,
          changeType: dep.changeType,
          repository: dep.repository || null
        },
        category: 'upgrade_only_in_project1',
        severity: determineSeverity('upgrade_only_in_project1', { changeType: dep.changeType })
      });
    }
  }

  for (const [name, dep] of p2UpgradedMap) {
    if (!p1UpgradedMap.has(name)) {
      upgradeOnlyInProject2.push({
        name,
        project2: {
          oldVersion: dep.oldVersion,
          newVersion: dep.newVersion,
          changeType: dep.changeType,
          repository: dep.repository || null
        },
        category: 'upgrade_only_in_project2',
        severity: determineSeverity('upgrade_only_in_project2', { changeType: dep.changeType })
      });
    }
  }

  // --- Cross-reference modified (namespace changes) ---
  const modifiedOnlyInProject1 = [];
  const modifiedOnlyInProject2 = [];
  const matchingModified = [];

  // For modified, we key by newName since that's the canonical identity after the change
  for (const [name, dep] of p1ModifiedMap) {
    if (p2ModifiedMap.has(name)) {
      matchingModified.push({
        name,
        project1: { oldName: dep.oldName, newName: dep.newName, oldVersion: dep.oldVersion, newVersion: dep.newVersion },
        project2: { oldName: p2ModifiedMap.get(name).oldName, newName: p2ModifiedMap.get(name).newName, oldVersion: p2ModifiedMap.get(name).oldVersion, newVersion: p2ModifiedMap.get(name).newVersion }
      });
    } else {
      modifiedOnlyInProject1.push({
        name: dep.newName,
        oldName: dep.oldName,
        newName: dep.newName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        category: 'modified_only_in_project1',
        severity: 'medium'
      });
    }
  }

  for (const [name, dep] of p2ModifiedMap) {
    if (!p1ModifiedMap.has(name)) {
      modifiedOnlyInProject2.push({
        name: dep.newName,
        oldName: dep.oldName,
        newName: dep.newName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        category: 'modified_only_in_project2',
        severity: 'medium'
      });
    }
  }

  // --- Handle nested dependencies if requested ---
  let nestedDiscrepancies = null;
  if (options.includeNested) {
    nestedDiscrepancies = compareNestedDeps(report1, report2, options, filtered);
  }

  // --- Build summary ---
  const totalDiscrepancies =
    addedOnlyInProject1.length +
    addedOnlyInProject2.length +
    removedOnlyInProject1.length +
    removedOnlyInProject2.length +
    versionMismatch.length +
    upgradeOnlyInProject1.length +
    upgradeOnlyInProject2.length +
    modifiedOnlyInProject1.length +
    modifiedOnlyInProject2.length;

  const totalMatching =
    matchingAdded.length +
    matchingRemoved.length +
    matchingUpgraded.length +
    matchingModified.length;

  // Deduplicate filtered items by name (same dep might be filtered in both reports)
  const uniqueFiltered = [];
  const seenFilteredNames = new Set();
  for (const item of filtered) {
    if (!seenFilteredNames.has(item.name)) {
      seenFilteredNames.add(item.name);
      uniqueFiltered.push(item);
    }
  }

  return {
    summary: {
      totalDiscrepancies,
      totalMatching,
      addedOnlyInProject1: addedOnlyInProject1.length,
      addedOnlyInProject2: addedOnlyInProject2.length,
      removedOnlyInProject1: removedOnlyInProject1.length,
      removedOnlyInProject2: removedOnlyInProject2.length,
      versionMismatch: versionMismatch.length,
      upgradeOnlyInProject1: upgradeOnlyInProject1.length,
      upgradeOnlyInProject2: upgradeOnlyInProject2.length,
      modifiedOnlyInProject1: modifiedOnlyInProject1.length,
      modifiedOnlyInProject2: modifiedOnlyInProject2.length
    },
    discrepancies: {
      addedOnlyInProject1,
      addedOnlyInProject2,
      removedOnlyInProject1,
      removedOnlyInProject2,
      versionMismatch,
      upgradeOnlyInProject1,
      upgradeOnlyInProject2,
      modifiedOnlyInProject1,
      modifiedOnlyInProject2
    },
    matching: {
      added: matchingAdded,
      removed: matchingRemoved,
      upgraded: matchingUpgraded,
      modified: matchingModified
    },
    nested: nestedDiscrepancies,
    filtered: uniqueFiltered
  };
};

/**
 * Compare nested dependencies between two reports
 * @param {Object} report1
 * @param {Object} report2
 * @param {CompareOptions} options
 * @param {Array} filtered - Filtered items accumulator
 * @returns {Object}
 */
const compareNestedDeps = (report1, report2, options, filtered) => {
  const nested1 = report1.changes.nested || { added: [], removed: [], upgraded: [], modified: [] };
  const nested2 = report2.changes.nested || { added: [], removed: [], upgraded: [], modified: [] };

  const n1Added = filterDeps(nested1.added || [], options, filtered);
  const n2Added = filterDeps(nested2.added || [], options, filtered);
  const n1Removed = filterDeps(nested1.removed || [], options, filtered);
  const n2Removed = filterDeps(nested2.removed || [], options, filtered);
  const n1Upgraded = filterDeps(nested1.upgraded || [], options, filtered);
  const n2Upgraded = filterDeps(nested2.upgraded || [], options, filtered);

  const n1AddedMap = buildLookup(n1Added);
  const n2AddedMap = buildLookup(n2Added);
  const n1RemovedMap = buildLookup(n1Removed);
  const n2RemovedMap = buildLookup(n2Removed);
  const n1UpgradedMap = buildLookup(n1Upgraded);
  const n2UpgradedMap = buildLookup(n2Upgraded);

  const addedOnlyInProject1 = [];
  const addedOnlyInProject2 = [];
  for (const [name, dep] of n1AddedMap) {
    if (!n2AddedMap.has(name)) {
      addedOnlyInProject1.push({ name, version: dep.version, parent: dep.parent, category: 'nested_added_only_in_project1', severity: 'medium' });
    }
  }
  for (const [name, dep] of n2AddedMap) {
    if (!n1AddedMap.has(name)) {
      addedOnlyInProject2.push({ name, version: dep.version, parent: dep.parent, category: 'nested_added_only_in_project2', severity: 'medium' });
    }
  }

  const removedOnlyInProject1 = [];
  const removedOnlyInProject2 = [];
  for (const [name, dep] of n1RemovedMap) {
    if (!n2RemovedMap.has(name)) {
      removedOnlyInProject1.push({ name, version: dep.version, parent: dep.parent, category: 'nested_removed_only_in_project1', severity: 'low' });
    }
  }
  for (const [name, dep] of n2RemovedMap) {
    if (!n1RemovedMap.has(name)) {
      removedOnlyInProject2.push({ name, version: dep.version, parent: dep.parent, category: 'nested_removed_only_in_project2', severity: 'low' });
    }
  }

  const versionMismatch = [];
  const upgradeOnlyInProject1 = [];
  const upgradeOnlyInProject2 = [];
  for (const [name, dep] of n1UpgradedMap) {
    if (n2UpgradedMap.has(name)) {
      const n2Dep = n2UpgradedMap.get(name);
      if (dep.newVersion !== n2Dep.newVersion || dep.oldVersion !== n2Dep.oldVersion) {
        versionMismatch.push({
          name,
          project1: { oldVersion: dep.oldVersion, newVersion: dep.newVersion, changeType: dep.changeType, parent: dep.parent },
          project2: { oldVersion: n2Dep.oldVersion, newVersion: n2Dep.newVersion, changeType: n2Dep.changeType, parent: n2Dep.parent },
          category: 'nested_version_mismatch',
          severity: determineSeverity('version_mismatch', { project1: dep, project2: n2Dep })
        });
      }
    } else {
      upgradeOnlyInProject1.push({
        name,
        project1: { oldVersion: dep.oldVersion, newVersion: dep.newVersion, changeType: dep.changeType, parent: dep.parent },
        category: 'nested_upgrade_only_in_project1',
        severity: 'low'
      });
    }
  }
  for (const [name, dep] of n2UpgradedMap) {
    if (!n1UpgradedMap.has(name)) {
      upgradeOnlyInProject2.push({
        name,
        project2: { oldVersion: dep.oldVersion, newVersion: dep.newVersion, changeType: dep.changeType, parent: dep.parent },
        category: 'nested_upgrade_only_in_project2',
        severity: 'low'
      });
    }
  }

  return {
    addedOnlyInProject1,
    addedOnlyInProject2,
    removedOnlyInProject1,
    removedOnlyInProject2,
    versionMismatch,
    upgradeOnlyInProject1,
    upgradeOnlyInProject2
  };
};

/**
 * Compare two report.json files and produce a comparison report
 * @param {string} project1Path - Path to first report.json
 * @param {string} project2Path - Path to second report.json
 * @param {CompareOptions} options - Comparison options
 * @returns {Promise<Object>} - Full comparison report object
 */
const compareReports = async (project1Path, project2Path, options = {}) => {
  const report1 = await loadReport(project1Path);
  const report2 = await loadReport(project2Path);

  const comparison = compareReportData(report1, report2, options);

  return {
    project1: {
      repository: report1.repository,
      olderVersion: report1.olderVersion,
      newerVersion: report1.newerVersion,
      timestamp: report1.timestamp,
      source: project1Path
    },
    project2: {
      repository: report2.repository,
      olderVersion: report2.olderVersion,
      newerVersion: report2.newerVersion,
      timestamp: report2.timestamp,
      source: project2Path
    },
    timestamp: new Date().toISOString(),
    options: {
      excludePatterns: options.excludePatterns || null,
      includePatterns: options.includePatterns || null,
      ignoreDev: options.ignoreDev || false,
      includeNested: options.includeNested || false
    },
    ...comparison
  };
};

export { compareReports, compareReportData, loadReport };
