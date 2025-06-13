#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate HTML report from JSON report
 * @param {string} jsonPath - Path to the report.json file
 * @param {string} outputPath - Path to save the HTML report (optional)
 * @returns {Promise<string>} - Path to the generated HTML file
 */
const generateHtmlReport = async (jsonPath, outputPath = null) => {
  try {
    // Read the report JSON
    const reportJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    
    // If no output path specified, create one with a specific naming format
    if (!outputPath) {
      const packageName = reportJson.repository.split('/').pop().replace('.git', '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      outputPath = `dependency-report-${packageName}-${reportJson.olderVersion}-${reportJson.newerVersion}-${timestamp}.html`;
    }
    
    // Generate HTML content
    const htmlContent = generateHtml(reportJson);
    
    // Write HTML file
    await writeFile(outputPath, htmlContent);
    
    console.log(`HTML report generated at: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error generating HTML report: ${error.message}`);
    throw error;
  }
};

/**
 * Generate HTML content from report data
 * @param {Object} report - Report data
 * @returns {string} - HTML content
 */
const generateHtml = (report) => {
  // Format repository URL for display and linking
  const repoUrl = report.repository.replace(/\.git$/, '');
  const repoDisplayUrl = repoUrl.replace(/^git@github\.com:/, 'https://github.com/')
                               .replace(/^git\+https:/, 'https:');
  
  // Get counts
  const addedCount = report.changes.added.length;
  const upgradedCount = report.changes.upgraded.length;
  const removedCount = report.changes.removed.length;
  const modifiedCount = report.changes.modified ? report.changes.modified.length : 0;
  const changelogCount = Object.keys(report.changelogs).length;
  const errorCount = report.errors ? Object.keys(report.errors).length : 0;
  
  // Get nested counts if available
  const nestedAddedCount = report.changes.nested ? report.changes.nested.added.length : 0;
  const nestedUpgradedCount = report.changes.nested ? report.changes.nested.upgraded.length : 0;
  const nestedRemovedCount = report.changes.nested ? report.changes.nested.removed.length : 0;
  
  // Generate HTML sections
  const addedSection = generateAddedSection(report.changes.added);
  const upgradedSection = generateUpgradedSection(report.changes.upgraded, report.changelogs);
  const removedSection = generateRemovedSection(report.changes.removed);
  const modifiedSection = generateModifiedSection(report.changes.modified || [], report.changelogs);
  const errorsSection = generateErrorsSection(report.errors || {});
  
  // Generate nested dependency sections if available
  let nestedAddedSection = '';
  let nestedUpgradedSection = '';
  let nestedRemovedSection = '';
  
  if (report.changes.nested) {
    nestedAddedSection = generateNestedAddedSection(report.changes.nested.added);
    nestedUpgradedSection = generateNestedUpgradedSection(report.changes.nested.upgraded, report.changelogs, report.ciStatus);
    nestedRemovedSection = generateNestedRemovedSection(report.changes.nested.removed);
  }
  
  // Format timestamp
  const timestamp = new Date(report.timestamp).toLocaleString();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dependency Changes: ${report.olderVersion} → ${report.newerVersion}</title>
  <style>
    :root {
      --primary-color: #3498db;
      --secondary-color: #2c3e50;
      --success-color: #2ecc71;
      --warning-color: #f39c12;
      --danger-color: #e74c3c;
      --light-color: #ecf0f1;
      --dark-color: #34495e;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f8f9fa;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      padding: 30px;
    }
    
    header {
      margin-bottom: 30px;
      border-bottom: 1px solid #eee;
      padding-bottom: 20px;
    }
    
    h1 {
      color: var(--secondary-color);
      margin-bottom: 10px;
    }
    
    h2 {
      color: var(--secondary-color);
      margin: 25px 0 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
    }
    
    h3 {
      margin: 20px 0 10px;
    }
    
    a {
      color: var(--primary-color);
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    .summary a {
      color: inherit;
      text-decoration: none;
      display: block;
      height: 100%;
    }
    
    .summary a:hover {
      transform: translateY(-2px);
      transition: transform 0.2s;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }
    
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin: 20px 0;
    }
    
    .summary-item {
      flex: 1;
      min-width: 200px;
      padding: 15px;
      border-radius: 6px;
      background-color: var(--light-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .summary-item.added {
      background-color: rgba(46, 204, 113, 0.2);
    }
    
    .summary-item.upgraded {
      background-color: rgba(52, 152, 219, 0.2);
    }
    
    .summary-item.removed {
      background-color: rgba(231, 76, 60, 0.2);
    }
    
    .summary-item.changelogs {
      background-color: rgba(155, 89, 182, 0.2);
    }
    
    .summary-count {
      font-size: 2em;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: bold;
      margin-left: 5px;
    }
    
    .badge.major {
      background-color: var(--danger-color);
      color: white;
    }
    
    .badge.minor {
      background-color: var(--warning-color);
      color: white;
    }
    
    .badge.patch {
      background-color: var(--success-color);
      color: white;
    }
    
    .badge.unknown {
      background-color: #95a5a6;
      color: white;
    }
    
    .badge.ci-success {
      background-color: var(--success-color);
      color: white;
    }
    
    .badge.ci-failure {
      background-color: var(--danger-color);
      color: white;
    }
    
    .badge.ci-in_progress {
      background-color: var(--warning-color);
      color: white;
    }
    
    .badge.ci-cancelled {
      background-color: #95a5a6;
      color: white;
    }
    
    .badge.ci-skipped {
      background-color: #95a5a6;
      color: white;
    }
    
    .badge.ci-other {
      background-color: #95a5a6;
      color: white;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    
    th {
      background-color: var(--light-color);
      font-weight: bold;
    }
    
    tr:hover {
      background-color: #f5f5f5;
    }
    
    .changelog {
      margin: 20px 0;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 6px;
      border-left: 4px solid var(--primary-color);
    }
    
    .commit {
      margin: 10px 0;
      padding: 10px;
      background-color: white;
      border-radius: 4px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .commit-hash {
      font-family: monospace;
      color: var(--secondary-color);
    }
    
    .commit-author {
      color: var(--dark-color);
      font-weight: bold;
    }
    
    .commit-date {
      color: #7f8c8d;
      font-size: 0.9em;
    }
    
    .commit-message {
      margin-top: 5px;
    }
    
    .empty-message {
      color: #7f8c8d;
      font-style: italic;
      margin: 20px 0;
    }
    
    footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      color: #7f8c8d;
      font-size: 0.9em;
      text-align: center;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 15px;
      }
      
      .summary {
        flex-direction: column;
      }
      
      table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Dependency Changes Report</h1>
      <p>
        Repository: <a href="${repoDisplayUrl}" target="_blank">${repoDisplayUrl}</a><br>
        Comparing: <strong>${report.olderVersion}</strong> → <strong>${report.newerVersion}</strong><br>
        Generated: ${timestamp}
        ${report.namespace ? `<br>Nested dependencies filtered by namespace: <strong>${report.namespace}</strong>` : ''}
      </p>
    </header>
    
    <div class="summary">
      <a href="#added-dependencies" class="summary-item added">
        <div class="summary-count">${addedCount}</div>
        <div>Dependencies Added</div>
      </a>
      <a href="#upgraded-dependencies" class="summary-item upgraded">
        <div class="summary-count">${upgradedCount}</div>
        <div>Dependencies Upgraded</div>
      </a>
      <a href="#removed-dependencies" class="summary-item removed">
        <div class="summary-count">${removedCount}</div>
        <div>Dependencies Removed</div>
      </a>
      <a href="#modified-dependencies" class="summary-item" style="background-color: rgba(155, 89, 182, 0.2);">
        <div class="summary-count">${modifiedCount}</div>
        <div>Dependencies Modified</div>
      </a>
      <a href="#changelogs" class="summary-item changelogs">
        <div class="summary-count">${changelogCount}</div>
        <div>Changelogs Generated</div>
      </a>
      <a href="#errors" class="summary-item errors" style="background-color: rgba(231, 76, 60, 0.2);">
        <div class="summary-count">${errorCount}</div>
        <div>Errors Encountered</div>
      </a>
    </div>
    
    ${(nestedAddedCount > 0 || nestedUpgradedCount > 0 || nestedRemovedCount > 0) ? `
    <h2>Nested Dependencies ${report.namespace ? `(Filtered by namespace: ${report.namespace})` : ''}</h2>
    <div class="summary">
      <a href="#nested-added-dependencies" class="summary-item added">
        <div class="summary-count">${nestedAddedCount}</div>
        <div>Nested Dependencies Added</div>
      </a>
      <a href="#nested-upgraded-dependencies" class="summary-item upgraded">
        <div class="summary-count">${nestedUpgradedCount}</div>
        <div>Nested Dependencies Upgraded</div>
      </a>
      <a href="#nested-removed-dependencies" class="summary-item removed">
        <div class="summary-count">${nestedRemovedCount}</div>
        <div>Nested Dependencies Removed</div>
      </a>
    </div>
    ` : ''}
    
    ${addedSection}
    ${generateUpgradedSection(report.changes.upgraded, report.changelogs, report.ciStatus)}
    ${removedSection}
    ${modifiedSection}
    
    ${nestedAddedSection}
    ${generateNestedUpgradedSection(report.changes.nested.upgraded, report.changelogs, report.ciStatus)}
    ${nestedRemovedSection}
    
    ${errorsSection}
    
    <footer>
      Generated by deep-depends-report
    </footer>
  </div>
</body>
</html>
  `;
};

/**
 * Generate HTML section for added dependencies
 * @param {Array} added - Added dependencies
 * @returns {string} - HTML content
 */
const generateAddedSection = (added) => {
  if (added.length === 0) {
    return `
      <h2 id="added-dependencies">Added Dependencies</h2>
      <p class="empty-message">No dependencies were added.</p>
    `;
  }
  
  const rows = added.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const repoUrl = dep.repository ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      null;
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${versionUrl}" target="_blank">${dep.version}</a></td>
        <td>${repoUrl ? `<a href="${repoUrl}" target="_blank">${repoUrl}</a>` : 'N/A'}</td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="added-dependencies">Added Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Version</th>
          <th>Repository</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

/**
 * Generate HTML section for upgraded dependencies
 * @param {Array} upgraded - Upgraded dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - HTML content
 */
const generateUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return `
      <h2 id="upgraded-dependencies">Upgraded Dependencies</h2>
      <p class="empty-message">No dependencies were upgraded.</p>
    `;
  }
  
  const rows = upgraded.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion}`;
    const repoUrl = dep.repository ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      (changelogs[dep.name] && changelogs[dep.name].repoUrl ? 
        changelogs[dep.name].repoUrl.replace(/\.git$/, '')
                            .replace(/^git@github\.com:/, 'https://github.com/')
                            .replace(/^git\+https:/, 'https:') : 
        null);
      
    const changeTypeBadge = `<span class="badge ${dep.changeType}">${dep.changeType}</span>`;
      
    // Add changelog link if available
    const changelogLink = changelogs[dep.name] ? 
      `<a href="#changelog-${dep.name}" title="View changelog">📋</a>` : 
      'N/A';
      
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${oldVersionUrl}" target="_blank">${dep.oldVersion}</a></td>
        <td><a href="${newVersionUrl}" target="_blank">${dep.newVersion}</a> ${changeTypeBadge}</td>
        <td>${repoUrl ? `<a href="${repoUrl}" target="_blank">${repoUrl}</a>` : 'N/A'}</td>
        <td>${changelogLink}</td>
      </tr>
    `;
  }).join('');
  
  // Generate changelog sections
  const changelogSections = upgraded
    .filter(dep => changelogs[dep.name])
    .map(dep => {
      const changelog = changelogs[dep.name];
      const repoUrl = changelog.repoUrl.replace(/\.git$/, '')
                                      .replace(/^git@github\.com:/, 'https://github.com/')
                                      .replace(/^git\+https:/, 'https:');
      
      const commits = changelog.commits.map(commit => {
        const commitUrl = `${repoUrl}/commit/${commit.hash}`;
        return `
          <div class="commit">
            <div>
              <a href="${commitUrl}" target="_blank" class="commit-hash">${commit.hash.substring(0, 7)}</a>
              <span class="commit-author">${commit.author}</span>
              <span class="commit-date">${commit.date}</span>
            </div>
            <div class="commit-message">${escapeHtml(commit.message)}</div>
          </div>
        `;
      }).join('');
      
      return `
        <h3 id="changelog-${dep.name}">${dep.name}: ${dep.oldVersion} → ${dep.newVersion}</h3>
        <div class="changelog">
          <p>Repository: <a href="${repoUrl}" target="_blank">${repoUrl}</a></p>
          <p>Commits: ${changelog.commits.length}</p>
          ${commits}
        </div>
      `;
    }).join('');
  
  return `
    <h2 id="upgraded-dependencies">Upgraded Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Old Version</th>
          <th>New Version</th>
          <th>Repository</th>
          <th>CI Status</th>
          <th>Changelog</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    
    <h2 id="changelogs">Changelogs</h2>
    ${changelogSections || '<p class="empty-message">No changelogs were generated.</p>'}
  `;
};

/**
 * Generate HTML section for removed dependencies
 * @param {Array} removed - Removed dependencies
 * @returns {string} - HTML content
 */
const generateRemovedSection = (removed) => {
  if (removed.length === 0) {
    return `
      <h2 id="removed-dependencies">Removed Dependencies</h2>
      <p class="empty-message">No dependencies were removed.</p>
    `;
  }
  
  const rows = removed.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${versionUrl}" target="_blank">${dep.version}</a></td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="removed-dependencies">Removed Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Version</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
const escapeHtml = (text) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};


/**
 * Generate HTML section for modified dependencies (namespace changes)
 * @param {Array} modified - Modified dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @returns {string} - HTML content
 */
const generateModifiedSection = (modified, changelogs = {}) => {
  if (modified.length === 0) {
    return `
      <h2 id="modified-dependencies">Modified Dependencies (Namespace Changes)</h2>
      <p class="empty-message">No dependencies had namespace changes.</p>
    `;
  }
  
  const rows = modified.map(dep => {
    const oldNpmUrl = `https://www.npmjs.com/package/${dep.oldName}`;
    const newNpmUrl = `https://www.npmjs.com/package/${dep.newName}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.oldName}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.newName}/v/${dep.newVersion}`;
    
    // Add changelog link if available
    const changelogLink = changelogs[dep.newName] ? 
      `<a href="#changelog-${dep.newName}" title="View changelog">📋</a>` : 
      'N/A';
    
    return `
      <tr>
        <td><a href="${oldNpmUrl}" target="_blank">${dep.oldName}</a></td>
        <td><a href="${newNpmUrl}" target="_blank">${dep.newName}</a></td>
        <td><a href="${oldVersionUrl}" target="_blank">${dep.oldVersion}</a></td>
        <td><a href="${newVersionUrl}" target="_blank">${dep.newVersion}</a></td>
        <td>${changelogLink}</td>
      </tr>
    `;
  }).join('');
  
  // Generate changelog sections for modified dependencies
  const changelogSections = modified
    .filter(dep => changelogs[dep.newName])
    .map(dep => {
      const changelog = changelogs[dep.newName];
      const repoUrl = changelog.repoUrl.replace(/\.git$/, '')
                                      .replace(/^git@github\.com:/, 'https://github.com/')
                                      .replace(/^git\+https:/, 'https:');
      
      const commits = changelog.commits.map(commit => {
        const commitUrl = `${repoUrl}/commit/${commit.hash}`;
        return `
          <div class="commit">
            <div>
              <a href="${commitUrl}" target="_blank" class="commit-hash">${commit.hash.substring(0, 7)}</a>
              <span class="commit-author">${commit.author}</span>
              <span class="commit-date">${commit.date}</span>
            </div>
            <div class="commit-message">${escapeHtml(commit.message)}</div>
          </div>
        `;
      }).join('');
      
      return `
        <h3 id="changelog-${dep.newName}">${dep.oldName} → ${dep.newName}: ${dep.oldVersion} → ${dep.newVersion}</h3>
        <div class="changelog">
          <p>Repository: <a href="${repoUrl}" target="_blank">${repoUrl}</a></p>
          <p>Commits: ${changelog.commits.length}</p>
          ${commits}
        </div>
      `;
    }).join('');
  
  return `
    <h2 id="modified-dependencies">Modified Dependencies (Namespace Changes)</h2>
    <p>These dependencies have changed their package name (typically from/to a namespace):</p>
    <table>
      <thead>
        <tr>
          <th>Old Package</th>
          <th>New Package</th>
          <th>Old Version</th>
          <th>New Version</th>
          <th>Changelog</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    
    ${changelogSections ? `
      <h3>Changelogs for Modified Dependencies</h3>
      ${changelogSections}
    ` : ''}
  `;
};

/**
 * Generate HTML section for errors encountered
 * @param {Object} errors - Errors object
 * @returns {string} - HTML content
 */
const generateErrorsSection = (errors) => {
  const errorCount = Object.keys(errors).length;
  
  if (errorCount === 0) {
    return `
      <h2 id="errors">Errors</h2>
      <p class="empty-message">No errors were encountered.</p>
    `;
  }
  
  const rows = Object.entries(errors).map(([name, info]) => {
    const npmUrl = `https://www.npmjs.com/package/${name}`;
    const repoUrl = info.repoUrl.replace(/\.git$/, '')
                               .replace(/^git@github\.com:/, 'https://github.com/')
                               .replace(/^git\+https:/, 'https:');
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${name}</a></td>
        <td><a href="${repoUrl}" target="_blank">${repoUrl}</a></td>
        <td>${info.oldVersion} → ${info.newVersion}</td>
        <td>${escapeHtml(info.error)}</td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="errors">Errors</h2>
    <p>The following dependencies encountered errors during changelog generation:</p>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Repository</th>
          <th>Version Change</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

/**
 * Generate HTML section for nested added dependencies
 * @param {Array} added - Added nested dependencies
 * @returns {string} - HTML content
 */
const generateNestedAddedSection = (added) => {
  if (added.length === 0) {
    return '';
  }
  
  const rows = added.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    const repoUrl = dep.repository ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      null;
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${versionUrl}" target="_blank">${dep.version}</a></td>
        <td><a href="${parentUrl}" target="_blank">${dep.parent}</a></td>
        <td>${repoUrl ? `<a href="${repoUrl}" target="_blank">${repoUrl}</a>` : 'N/A'}</td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="nested-added-dependencies">Nested Added Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Version</th>
          <th>Parent Package</th>
          <th>Repository</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

/**
 * Generate HTML section for nested upgraded dependencies
 * @param {Array} upgraded - Upgraded nested dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - HTML content
 */
const generateNestedUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return '';
  }
  
  const rows = upgraded.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    const repoUrl = dep.repository ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      (changelogs[dep.name] && changelogs[dep.name].repoUrl ? 
        changelogs[dep.name].repoUrl.replace(/\.git$/, '')
                            .replace(/^git@github\.com:/, 'https://github.com/')
                            .replace(/^git\+https:/, 'https:') : 
        null);
      
    const changeTypeBadge = `<span class="badge ${dep.changeType}">${dep.changeType}</span>`;
    
    // Generate CI status badge and link
    const ciInfo = ciStatus[dep.name];
    let ciStatusCell = 'N/A';
    if (ciInfo && ciInfo.latestRun) {
      const statusBadge = `<span class="badge ci-${ciInfo.status}">${ciInfo.status}</span>`;
      const ciLink = `<a href="${ciInfo.latestRun.url}" target="_blank" title="View CI run">${statusBadge}</a>`;
      ciStatusCell = ciLink;
    } else if (ciInfo) {
      const statusBadge = `<span class="badge ci-${ciInfo.status}">${ciInfo.status}</span>`;
      ciStatusCell = statusBadge;
    }
      
    // Add changelog link if available
    const changelogLink = changelogs[dep.name] ? 
      `<a href="#changelog-${dep.name}" title="View changelog">📋</a>` : 
      'N/A';
      
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${oldVersionUrl}" target="_blank">${dep.oldVersion}</a></td>
        <td><a href="${newVersionUrl}" target="_blank">${dep.newVersion}</a> ${changeTypeBadge}</td>
        <td><a href="${parentUrl}" target="_blank">${dep.parent}</a></td>
        <td>${repoUrl ? `<a href="${repoUrl}" target="_blank">${repoUrl}</a>` : 'N/A'}</td>
        <td>${ciStatusCell}</td>
        <td>${changelogLink}</td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="nested-upgraded-dependencies">Nested Upgraded Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Old Version</th>
          <th>New Version</th>
          <th>Parent Package</th>
          <th>Repository</th>
          <th>CI Status</th>
          <th>Changelog</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

/**
 * Generate HTML section for nested removed dependencies
 * @param {Array} removed - Removed nested dependencies
 * @returns {string} - HTML content
 */
const generateNestedRemovedSection = (removed) => {
  if (removed.length === 0) {
    return '';
  }
  
  const rows = removed.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${versionUrl}" target="_blank">${dep.version}</a></td>
        <td><a href="${parentUrl}" target="_blank">${dep.parent}</a></td>
      </tr>
    `;
  }).join('');
  
  return `
    <h2 id="nested-removed-dependencies">Nested Removed Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Version</th>
          <th>Parent Package</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

export { generateHtmlReport };
