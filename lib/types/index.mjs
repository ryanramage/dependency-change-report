/**
 * @typedef {Object} DependencyInfo
 * @property {string} version - Package version
 * @property {string} [repository] - Repository URL
 * @property {Object} [dependencies] - Nested dependencies
 */

/**
 * @typedef {Object} DependencyChange
 * @property {string} name - Package name
 * @property {string} oldVersion - Previous version
 * @property {string} newVersion - New version
 * @property {string} changeType - Type of change (major, minor, patch, unknown)
 * @property {string} [repository] - Repository URL
 */

/**
 * @typedef {Object} NestedDependencyChange
 * @property {string} name - Package name
 * @property {string} oldVersion - Previous version
 * @property {string} newVersion - New version
 * @property {string} changeType - Type of change (major, minor, patch, unknown)
 * @property {string} [repository] - Repository URL
 * @property {string} parent - Parent package name
 */

/**
 * @typedef {Object} ModifiedDependency
 * @property {string} oldName - Previous package name
 * @property {string} newName - New package name
 * @property {string} oldVersion - Previous version
 * @property {string} newVersion - New version
 * @property {string} changeType - Type of change (namespace)
 */

/**
 * @typedef {Object} ComparisonResult
 * @property {Array<DependencyInfo>} added - Added dependencies
 * @property {Array<DependencyInfo>} removed - Removed dependencies
 * @property {Array<DependencyChange>} upgraded - Upgraded dependencies
 * @property {Array<ModifiedDependency>} modified - Modified dependencies (namespace changes)
 * @property {Object} nested - Nested dependency changes
 * @property {Array<DependencyInfo>} nested.added - Added nested dependencies
 * @property {Array<DependencyInfo>} nested.removed - Removed nested dependencies
 * @property {Array<NestedDependencyChange>} nested.upgraded - Upgraded nested dependencies
 * @property {Array<ModifiedDependency>} nested.modified - Modified nested dependencies
 */

/**
 * @typedef {Object} CommitInfo
 * @property {string} hash - Commit hash
 * @property {string} author - Commit author
 * @property {string} date - Commit date
 * @property {string} message - Commit message
 */

/**
 * @typedef {Object} ChangelogInfo
 * @property {string} repoUrl - Repository URL
 * @property {string} oldVersion - Old version
 * @property {string} newVersion - New version
 * @property {Array<CommitInfo>} commits - Array of commits
 */

/**
 * @typedef {Object} ErrorInfo
 * @property {string} repoUrl - Repository URL
 * @property {string} oldVersion - Old version
 * @property {string} newVersion - New version
 * @property {string} error - Error message
 */

/**
 * @typedef {Object} CIStatusInfo
 * @property {string} status - Overall CI status
 * @property {string} [commitSha] - Commit SHA
 * @property {number} [totalRuns] - Total number of workflow runs
 * @property {Object} [statusCounts] - Count of different statuses
 * @property {Object} [latestRun] - Latest workflow run info
 * @property {string} [actionsUrl] - GitHub Actions URL
 * @property {string} [error] - Error message if status check failed
 */

/**
 * @typedef {Object} AnalysisReport
 * @property {string} repository - Repository URL
 * @property {string} olderVersion - Older version reference
 * @property {string} newerVersion - Newer version reference
 * @property {string} timestamp - Analysis timestamp
 * @property {ComparisonResult} changes - Dependency changes
 * @property {Object<string, ChangelogInfo>} changelogs - Changelogs by package name
 * @property {Object<string, ErrorInfo>} errors - Errors by package name
 * @property {Object<string, CIStatusInfo>} ciStatus - CI status by package name
 * @property {string|null} namespace - Optional namespace filter
 * @property {string} reportPath - Path to the generated report file
 */

export {};
