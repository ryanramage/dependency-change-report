import { readFile } from 'fs/promises';
import { minimatch } from 'minimatch';
import semver from 'semver';

/**
 * @typedef {Object} CompareOptions
 * @property {string[]} [excludePatterns] - Glob patterns to exclude from comparison
 * @property {string[]} [includePatterns] - Glob patterns to include (only these are compared)
 * @property {boolean} [ignoreDev] - Exclude devDependencies from comparison
 * @property {boolean} [includeNested] - Include nested/transitive dependencies
 */

/**
 * Check if a string is a remote URL
 * @param {string} str
 * @returns {boolean}
 */
const isUrl = (str) => str.startsWith('https://') || str.startsWith('http://');

/**
 * Load and parse a report.json file from a local path or remote URL
 * @param {string} jsonPath - Path or URL to report.json
 * @returns {Promise<Object>} - Parsed report object
 */
const loadReport = async (jsonPath) => {
  try {
    let content;
    if (isUrl(jsonPath)) {
      const response = await fetch(jsonPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      content = await response.text();
    } else {
      content = await readFile(jsonPath, 'utf8');
    }
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Report file not found: ${jsonPath}`);
    }
    throw new Error(`Failed to load report ${jsonPath}: ${error.message}`);
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
 * Compute the semver change type between two versions
 * @param {string} oldVer
 * @param {string} newVer
 * @returns {string} - major | minor | patch | unknown
 */
const computeChangeType = (oldVer, newVer) => {
  try {
    if (semver.valid(oldVer) && semver.valid(newVer)) {
      if (semver.major(newVer) > semver.major(oldVer)) return 'major';
      if (semver.minor(newVer) > semver.minor(oldVer)) return 'minor';
      if (semver.patch(newVer) > semver.patch(oldVer)) return 'patch';
    }
  } catch { /* fall through */ }
  return 'unknown';
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
      if (details.project1?.changeType === 'major' || details.project2?.changeType === 'major') return 'high';
      if (details.project1?.changeType === 'minor' || details.project2?.changeType === 'minor') return 'medium';
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
    if (options.ignoreDev && dep.devDep) {
      filteredOut.push({ name, reason: 'devDependency (--ignore-dev)' });
      return false;
    }
    if (options.excludePatterns && options.excludePatterns.length > 0) {
      if (matchesAnyPattern(name, options.excludePatterns)) {
        const matchedPattern = options.excludePatterns.find(p => minimatch(name, p));
        filteredOut.push({ name, reason: `matched exclude pattern: ${matchedPattern}` });
        return false;
      }
    }
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

// --- Installed data helpers ---

/**
 * Get the primary installed version for a package from a snapshot
 * @param {Object|null} snapshot - installed.newer or installed.older
 * @param {string} name - Package name
 * @returns {string|null}
 */
const getInstalledVersion = (snapshot, name) => {
  const entry = snapshot?.[name];
  if (!entry) return null;
  return entry.topLevelVersion || entry.allVersions?.[0] || null;
};

/**
 * Check if a specific version exists in an installed snapshot
 * @param {Object|null} snapshot - installed snapshot
 * @param {string} name - Package name
 * @param {string} version - Version to check
 * @returns {boolean}
 */
const versionExistsInstalled = (snapshot, name, version) => {
  const entry = snapshot?.[name];
  if (!entry) return false;
  return entry.topLevelVersion === version || (entry.allVersions && entry.allVersions.includes(version));
};

/**
 * Build a synthetic version-change object from installed snapshots
 * Used when one side didn't have a recorded change but did have the dep installed
 * @param {Object|null} installedOlder - installed.older snapshot
 * @param {Object|null} installedNewer - installed.newer snapshot
 * @param {string} name - Package name
 * @returns {Object} - { oldVersion, newVersion, changeType, fromInstalled: true }
 */
const buildSyntheticFromInstalled = (installedOlder, installedNewer, name) => {
  const oldVer = getInstalledVersion(installedOlder, name);
  const newVer = getInstalledVersion(installedNewer, name);
  let changeType = 'none';
  if (oldVer && newVer && oldVer !== newVer) {
    changeType = computeChangeType(oldVer, newVer);
  }
  return { oldVersion: oldVer, newVersion: newVer, changeType, fromInstalled: true };
};

/**
 * Annotate a discrepancy item with installed version info from the other project
 * and adjust severity if end-states match
 * @param {Object} item - Discrepancy item
 * @param {Object|null} otherInstalled - installed.newer from the other project
 * @param {string} endStateVersion - The version to compare against
 * @returns {Object} - Annotated item (mutated)
 */
const annotateWithInstalled = (item, otherInstalled, endStateVersion) => {
  if (!otherInstalled) return item;
  const entry = otherInstalled[item.name];
  if (entry) {
    const matchesEndState = entry.topLevelVersion === endStateVersion ||
      (entry.allVersions && entry.allVersions.includes(endStateVersion));
    item.otherProjectInstalled = {
      topLevelVersion: entry.topLevelVersion,
      allVersions: entry.allVersions,
      matchesEndState
    };
    if (matchesEndState) {
      item.severity = 'low';
    }
  }
  return item;
};

/**
 * Classify discrepancy items into real discrepancies vs framework-specific.
 * Framework-specific = the dep doesn't exist at all in the other project's installed packages.
 * @param {Array} items - Array of discrepancy items
 * @param {Object|null} otherInstalledNewer - installed.newer from the other project's report
 * @returns {{ real: Array, frameworkSpecific: Array }}
 */
const classifyItems = (items, otherInstalledNewer) => {
  if (!otherInstalledNewer) {
    return { real: items, frameworkSpecific: [] };
  }
  const real = [];
  const frameworkSpecific = [];
  for (const item of items) {
    if (otherInstalledNewer[item.name]) {
      real.push(item);
    } else {
      frameworkSpecific.push({ ...item, classification: 'framework_specific' });
    }
  }
  return { real, frameworkSpecific };
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

  // Check for installed data availability
  const hasInstalledData = !!(report1.installed && report2.installed);
  const p1InstalledOlder = report1.installed?.older || null;
  const p1InstalledNewer = report1.installed?.newer || null;
  const p2InstalledOlder = report2.installed?.older || null;
  const p2InstalledNewer = report2.installed?.newer || null;

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

  // =====================================================================
  // ADDITIONS — unified classification
  // =====================================================================
  const addedOnlyInProject1 = [];
  const addedOnlyInProject2 = [];
  const matchingAdded = [];

  // Track which names we've already handled
  const handledAddedNames = new Set();

  // Case A: Both projects added the same package
  for (const [name, dep] of p1AddedMap) {
    if (p2AddedMap.has(name)) {
      handledAddedNames.add(name);
      const p2Dep = p2AddedMap.get(name);
      matchingAdded.push({
        name,
        project1: { version: dep.version },
        project2: { version: p2Dep.version },
        versionsMatch: dep.version === p2Dep.version
      });
    }
  }

  // Case B/D: Only one side added, check if other side already had it installed at same version
  for (const [name, dep] of p1AddedMap) {
    if (handledAddedNames.has(name)) continue;
    // P1 added, P2 did not add — check P2's installed
    if (hasInstalledData && versionExistsInstalled(p2InstalledNewer, name, dep.version)) {
      // P2 already had it at the same version → matching
      handledAddedNames.add(name);
      matchingAdded.push({
        name,
        project1: { version: dep.version },
        project2: { version: dep.version, fromInstalled: true },
        versionsMatch: true
      });
    } else {
      handledAddedNames.add(name);
      const item = {
        name,
        version: dep.version,
        repository: dep.repository || null,
        category: 'added_only_in_project1',
        severity: determineSeverity('added_only_in_project1')
      };
      annotateWithInstalled(item, p2InstalledNewer, dep.version);
      addedOnlyInProject1.push(item);
    }
  }

  for (const [name, dep] of p2AddedMap) {
    if (handledAddedNames.has(name)) continue;
    // P2 added, P1 did not add — check P1's installed
    if (hasInstalledData && versionExistsInstalled(p1InstalledNewer, name, dep.version)) {
      // P1 already had it at the same version → matching
      handledAddedNames.add(name);
      matchingAdded.push({
        name,
        project1: { version: dep.version, fromInstalled: true },
        project2: { version: dep.version },
        versionsMatch: true
      });
    } else {
      handledAddedNames.add(name);
      const item = {
        name,
        version: dep.version,
        repository: dep.repository || null,
        category: 'added_only_in_project2',
        severity: determineSeverity('added_only_in_project2')
      };
      annotateWithInstalled(item, p1InstalledNewer, dep.version);
      addedOnlyInProject2.push(item);
    }
  }

  // =====================================================================
  // REMOVALS — unchanged logic (no installed-based matching needed)
  // =====================================================================
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
      const item = {
        name,
        version: dep.version,
        category: 'removed_only_in_project1',
        severity: determineSeverity('removed_only_in_project1')
      };
      annotateWithInstalled(item, p2InstalledNewer, dep.version);
      removedOnlyInProject1.push(item);
    }
  }

  for (const [name, dep] of p2RemovedMap) {
    if (!p1RemovedMap.has(name)) {
      const item = {
        name,
        version: dep.version,
        category: 'removed_only_in_project2',
        severity: determineSeverity('removed_only_in_project2')
      };
      annotateWithInstalled(item, p1InstalledNewer, dep.version);
      removedOnlyInProject2.push(item);
    }
  }

  // =====================================================================
  // UPGRADES — unified classification
  // =====================================================================
  const versionMismatch = [];
  const upgradeOnlyInProject1 = [];
  const upgradeOnlyInProject2 = [];
  const matchingUpgraded = [];

  // Iterate over the union of upgraded names
  const allUpgradedNames = new Set([...p1UpgradedMap.keys(), ...p2UpgradedMap.keys()]);

  for (const name of allUpgradedNames) {
    const p1Up = p1UpgradedMap.get(name);
    const p2Up = p2UpgradedMap.get(name);

    if (p1Up && p2Up) {
      // Case A/B: Both projects upgraded this package
      if (p1Up.newVersion === p2Up.newVersion) {
        // Case A: Same end version → matching (even if different start)
        matchingUpgraded.push({
          name,
          project1: { oldVersion: p1Up.oldVersion, newVersion: p1Up.newVersion, changeType: p1Up.changeType },
          project2: { oldVersion: p2Up.oldVersion, newVersion: p2Up.newVersion, changeType: p2Up.changeType },
          oldVersionsMatch: p1Up.oldVersion === p2Up.oldVersion
        });
      } else {
        // Case B: Different end versions → real version mismatch
        const details = {
          project1: { changeType: p1Up.changeType },
          project2: { changeType: p2Up.changeType }
        };
        const item = {
          name,
          project1: {
            oldVersion: p1Up.oldVersion, newVersion: p1Up.newVersion,
            changeType: p1Up.changeType, repository: p1Up.repository || null
          },
          project2: {
            oldVersion: p2Up.oldVersion, newVersion: p2Up.newVersion,
            changeType: p2Up.changeType, repository: p2Up.repository || null
          },
          category: 'version_mismatch',
          severity: determineSeverity('version_mismatch', details)
        };
        // Annotate with actual installed versions
        if (p1InstalledNewer) {
          const v = getInstalledVersion(p1InstalledNewer, name);
          if (v) item.project1InstalledVersion = v;
        }
        if (p2InstalledNewer) {
          const v = getInstalledVersion(p2InstalledNewer, name);
          if (v) item.project2InstalledVersion = v;
        }
        versionMismatch.push(item);
      }
    } else if (p1Up && !p2Up) {
      // Only P1 upgraded — check if P2 is already at P1's newVersion
      if (hasInstalledData && versionExistsInstalled(p2InstalledNewer, name, p1Up.newVersion)) {
        // Case C: P2 already at the target version → matching
        const p2Synthetic = buildSyntheticFromInstalled(p2InstalledOlder, p2InstalledNewer, name);
        matchingUpgraded.push({
          name,
          project1: { oldVersion: p1Up.oldVersion, newVersion: p1Up.newVersion, changeType: p1Up.changeType },
          project2: p2Synthetic,
          oldVersionsMatch: false
        });
      } else {
        // Case E: real one-sided upgrade
        const item = {
          name,
          project1: {
            oldVersion: p1Up.oldVersion, newVersion: p1Up.newVersion,
            changeType: p1Up.changeType, repository: p1Up.repository || null
          },
          category: 'upgrade_only_in_project1',
          severity: determineSeverity('upgrade_only_in_project1', { changeType: p1Up.changeType })
        };
        annotateWithInstalled(item, p2InstalledNewer, p1Up.newVersion);
        upgradeOnlyInProject1.push(item);
      }
    } else if (p2Up && !p1Up) {
      // Only P2 upgraded — check if P1 is already at P2's newVersion
      if (hasInstalledData && versionExistsInstalled(p1InstalledNewer, name, p2Up.newVersion)) {
        // Case D: P1 already at the target version → matching
        const p1Synthetic = buildSyntheticFromInstalled(p1InstalledOlder, p1InstalledNewer, name);
        matchingUpgraded.push({
          name,
          project1: p1Synthetic,
          project2: { oldVersion: p2Up.oldVersion, newVersion: p2Up.newVersion, changeType: p2Up.changeType },
          oldVersionsMatch: false
        });
      } else {
        // Case F: real one-sided upgrade
        const item = {
          name,
          project2: {
            oldVersion: p2Up.oldVersion, newVersion: p2Up.newVersion,
            changeType: p2Up.changeType, repository: p2Up.repository || null
          },
          category: 'upgrade_only_in_project2',
          severity: determineSeverity('upgrade_only_in_project2', { changeType: p2Up.changeType })
        };
        annotateWithInstalled(item, p1InstalledNewer, p2Up.newVersion);
        upgradeOnlyInProject2.push(item);
      }
    }
  }

  // =====================================================================
  // MODIFIED (namespace changes) — unchanged logic
  // =====================================================================
  const modifiedOnlyInProject1 = [];
  const modifiedOnlyInProject2 = [];
  const matchingModified = [];

  for (const [name, dep] of p1ModifiedMap) {
    if (p2ModifiedMap.has(name)) {
      matchingModified.push({
        name,
        project1: { oldName: dep.oldName, newName: dep.newName, oldVersion: dep.oldVersion, newVersion: dep.newVersion },
        project2: { oldName: p2ModifiedMap.get(name).oldName, newName: p2ModifiedMap.get(name).newName, oldVersion: p2ModifiedMap.get(name).oldVersion, newVersion: p2ModifiedMap.get(name).newVersion }
      });
    } else {
      modifiedOnlyInProject1.push({
        name: dep.newName, oldName: dep.oldName, newName: dep.newName,
        oldVersion: dep.oldVersion, newVersion: dep.newVersion,
        category: 'modified_only_in_project1', severity: 'medium'
      });
    }
  }

  for (const [name, dep] of p2ModifiedMap) {
    if (!p1ModifiedMap.has(name)) {
      modifiedOnlyInProject2.push({
        name: dep.newName, oldName: dep.oldName, newName: dep.newName,
        oldVersion: dep.oldVersion, newVersion: dep.newVersion,
        category: 'modified_only_in_project2', severity: 'medium'
      });
    }
  }

  // =====================================================================
  // NESTED DEPENDENCIES
  // =====================================================================
  let nestedDiscrepancies = null;
  if (options.includeNested) {
    nestedDiscrepancies = compareNestedDeps(report1, report2, options, filtered);
  }

  // =====================================================================
  // CLASSIFY into real discrepancies vs framework-specific
  // =====================================================================
  const frameworkSpecific = {
    addedOnlyInProject1: [],
    addedOnlyInProject2: [],
    removedOnlyInProject1: [],
    removedOnlyInProject2: [],
    upgradeOnlyInProject1: [],
    upgradeOnlyInProject2: []
  };

  let realAddedP1 = addedOnlyInProject1;
  let realAddedP2 = addedOnlyInProject2;
  let realRemovedP1 = removedOnlyInProject1;
  let realRemovedP2 = removedOnlyInProject2;
  let realUpgradeP1 = upgradeOnlyInProject1;
  let realUpgradeP2 = upgradeOnlyInProject2;

  if (hasInstalledData) {
    const classAddedP1 = classifyItems(addedOnlyInProject1, p2InstalledNewer);
    realAddedP1 = classAddedP1.real;
    frameworkSpecific.addedOnlyInProject1 = classAddedP1.frameworkSpecific;

    const classAddedP2 = classifyItems(addedOnlyInProject2, p1InstalledNewer);
    realAddedP2 = classAddedP2.real;
    frameworkSpecific.addedOnlyInProject2 = classAddedP2.frameworkSpecific;

    const classRemovedP1 = classifyItems(removedOnlyInProject1, p2InstalledNewer);
    realRemovedP1 = classRemovedP1.real;
    frameworkSpecific.removedOnlyInProject1 = classRemovedP1.frameworkSpecific;

    const classRemovedP2 = classifyItems(removedOnlyInProject2, p1InstalledNewer);
    realRemovedP2 = classRemovedP2.real;
    frameworkSpecific.removedOnlyInProject2 = classRemovedP2.frameworkSpecific;

    const classUpgradeP1 = classifyItems(upgradeOnlyInProject1, p2InstalledNewer);
    realUpgradeP1 = classUpgradeP1.real;
    frameworkSpecific.upgradeOnlyInProject1 = classUpgradeP1.frameworkSpecific;

    const classUpgradeP2 = classifyItems(upgradeOnlyInProject2, p1InstalledNewer);
    realUpgradeP2 = classUpgradeP2.real;
    frameworkSpecific.upgradeOnlyInProject2 = classUpgradeP2.frameworkSpecific;
  }

  // =====================================================================
  // BUILD SUMMARY
  // =====================================================================
  const totalDiscrepancies =
    realAddedP1.length + realAddedP2.length +
    realRemovedP1.length + realRemovedP2.length +
    versionMismatch.length +
    realUpgradeP1.length + realUpgradeP2.length +
    modifiedOnlyInProject1.length + modifiedOnlyInProject2.length;

  const totalFrameworkSpecific =
    frameworkSpecific.addedOnlyInProject1.length + frameworkSpecific.addedOnlyInProject2.length +
    frameworkSpecific.removedOnlyInProject1.length + frameworkSpecific.removedOnlyInProject2.length +
    frameworkSpecific.upgradeOnlyInProject1.length + frameworkSpecific.upgradeOnlyInProject2.length;

  const totalMatching =
    matchingAdded.length + matchingRemoved.length +
    matchingUpgraded.length + matchingModified.length;

  // Deduplicate filtered items by name
  const uniqueFiltered = [];
  const seenFilteredNames = new Set();
  for (const item of filtered) {
    if (!seenFilteredNames.has(item.name)) {
      seenFilteredNames.add(item.name);
      uniqueFiltered.push(item);
    }
  }

  return {
    hasInstalledData,
    summary: {
      totalDiscrepancies,
      totalFrameworkSpecific,
      totalMatching,
      addedOnlyInProject1: realAddedP1.length,
      addedOnlyInProject2: realAddedP2.length,
      removedOnlyInProject1: realRemovedP1.length,
      removedOnlyInProject2: realRemovedP2.length,
      versionMismatch: versionMismatch.length,
      upgradeOnlyInProject1: realUpgradeP1.length,
      upgradeOnlyInProject2: realUpgradeP2.length,
      modifiedOnlyInProject1: modifiedOnlyInProject1.length,
      modifiedOnlyInProject2: modifiedOnlyInProject2.length
    },
    discrepancies: {
      addedOnlyInProject1: realAddedP1,
      addedOnlyInProject2: realAddedP2,
      removedOnlyInProject1: realRemovedP1,
      removedOnlyInProject2: realRemovedP2,
      versionMismatch,
      upgradeOnlyInProject1: realUpgradeP1,
      upgradeOnlyInProject2: realUpgradeP2,
      modifiedOnlyInProject1,
      modifiedOnlyInProject2
    },
    frameworkSpecific,
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

  const hasInstalledData = !!(report1.installed && report2.installed);
  const p1InstalledOlder = report1.installed?.older || null;
  const p1InstalledNewer = report1.installed?.newer || null;
  const p2InstalledOlder = report2.installed?.older || null;
  const p2InstalledNewer = report2.installed?.newer || null;

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

  // --- Nested additions ---
  const addedOnlyInProject1 = [];
  const addedOnlyInProject2 = [];
  const matchingAdded = [];
  const handledAddedNames = new Set();

  for (const [name, dep] of n1AddedMap) {
    if (n2AddedMap.has(name)) {
      handledAddedNames.add(name);
      matchingAdded.push({ name, project1: { version: dep.version, parent: dep.parent }, project2: { version: n2AddedMap.get(name).version, parent: n2AddedMap.get(name).parent }, versionsMatch: dep.version === n2AddedMap.get(name).version });
    }
  }
  for (const [name, dep] of n1AddedMap) {
    if (handledAddedNames.has(name)) continue;
    if (hasInstalledData && versionExistsInstalled(p2InstalledNewer, name, dep.version)) {
      handledAddedNames.add(name);
      matchingAdded.push({ name, project1: { version: dep.version, parent: dep.parent }, project2: { version: dep.version, fromInstalled: true }, versionsMatch: true });
    } else {
      handledAddedNames.add(name);
      addedOnlyInProject1.push({ name, version: dep.version, parent: dep.parent, category: 'nested_added_only_in_project1', severity: 'medium' });
    }
  }
  for (const [name, dep] of n2AddedMap) {
    if (handledAddedNames.has(name)) continue;
    if (hasInstalledData && versionExistsInstalled(p1InstalledNewer, name, dep.version)) {
      handledAddedNames.add(name);
      matchingAdded.push({ name, project1: { version: dep.version, fromInstalled: true }, project2: { version: dep.version, parent: dep.parent }, versionsMatch: true });
    } else {
      handledAddedNames.add(name);
      addedOnlyInProject2.push({ name, version: dep.version, parent: dep.parent, category: 'nested_added_only_in_project2', severity: 'medium' });
    }
  }

  // --- Nested removals ---
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

  // --- Nested upgrades (unified, same logic as top-level) ---
  const versionMismatch = [];
  const upgradeOnlyInProject1 = [];
  const upgradeOnlyInProject2 = [];
  const matchingUpgraded = [];

  const allNestedUpgradedNames = new Set([...n1UpgradedMap.keys(), ...n2UpgradedMap.keys()]);

  for (const name of allNestedUpgradedNames) {
    const n1Up = n1UpgradedMap.get(name);
    const n2Up = n2UpgradedMap.get(name);

    if (n1Up && n2Up) {
      if (n1Up.newVersion === n2Up.newVersion) {
        matchingUpgraded.push({
          name,
          project1: { oldVersion: n1Up.oldVersion, newVersion: n1Up.newVersion, changeType: n1Up.changeType, parent: n1Up.parent },
          project2: { oldVersion: n2Up.oldVersion, newVersion: n2Up.newVersion, changeType: n2Up.changeType, parent: n2Up.parent },
          oldVersionsMatch: n1Up.oldVersion === n2Up.oldVersion
        });
      } else {
        versionMismatch.push({
          name,
          project1: { oldVersion: n1Up.oldVersion, newVersion: n1Up.newVersion, changeType: n1Up.changeType, parent: n1Up.parent },
          project2: { oldVersion: n2Up.oldVersion, newVersion: n2Up.newVersion, changeType: n2Up.changeType, parent: n2Up.parent },
          category: 'nested_version_mismatch',
          severity: determineSeverity('version_mismatch', { project1: n1Up, project2: n2Up })
        });
      }
    } else if (n1Up && !n2Up) {
      if (hasInstalledData && versionExistsInstalled(p2InstalledNewer, name, n1Up.newVersion)) {
        const p2Synthetic = buildSyntheticFromInstalled(p2InstalledOlder, p2InstalledNewer, name);
        matchingUpgraded.push({
          name,
          project1: { oldVersion: n1Up.oldVersion, newVersion: n1Up.newVersion, changeType: n1Up.changeType, parent: n1Up.parent },
          project2: { ...p2Synthetic },
          oldVersionsMatch: false
        });
      } else {
        upgradeOnlyInProject1.push({
          name,
          project1: { oldVersion: n1Up.oldVersion, newVersion: n1Up.newVersion, changeType: n1Up.changeType, parent: n1Up.parent },
          category: 'nested_upgrade_only_in_project1', severity: 'low'
        });
      }
    } else if (n2Up && !n1Up) {
      if (hasInstalledData && versionExistsInstalled(p1InstalledNewer, name, n2Up.newVersion)) {
        const p1Synthetic = buildSyntheticFromInstalled(p1InstalledOlder, p1InstalledNewer, name);
        matchingUpgraded.push({
          name,
          project1: { ...p1Synthetic },
          project2: { oldVersion: n2Up.oldVersion, newVersion: n2Up.newVersion, changeType: n2Up.changeType, parent: n2Up.parent },
          oldVersionsMatch: false
        });
      } else {
        upgradeOnlyInProject2.push({
          name,
          project2: { oldVersion: n2Up.oldVersion, newVersion: n2Up.newVersion, changeType: n2Up.changeType, parent: n2Up.parent },
          category: 'nested_upgrade_only_in_project2', severity: 'low'
        });
      }
    }
  }

  return {
    addedOnlyInProject1,
    addedOnlyInProject2,
    matchingAdded,
    removedOnlyInProject1,
    removedOnlyInProject2,
    versionMismatch,
    upgradeOnlyInProject1,
    upgradeOnlyInProject2,
    matchingUpgraded
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
