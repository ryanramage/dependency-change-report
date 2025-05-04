#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
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
    
    // If no output path specified, create one next to the JSON file
    if (!outputPath) {
      outputPath = jsonPath.replace(/\.json$/, '.html');
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
  const repoDisplayUrl = repoUrl.replace(/^git@github\.com:/, 'https://github.com/');
  
  // Get counts
  const addedCount = report.changes.added.length;
  const upgradedCount = report.changes.upgraded.length;
  const removedCount = report.changes.removed.length;
  const changelogCount = Object.keys(report.changelogs).length;
  
  // Generate HTML sections
  const addedSection = generateAddedSection(report.changes.added);
  const upgradedSection = generateUpgradedSection(report.changes.upgraded, report.changelogs);
  const removedSection = generateRemovedSection(report.changes.removed);
  
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
      </p>
    </header>
    
    <div class="summary">
      <div class="summary-item added">
        <div class="summary-count">${addedCount}</div>
        <div>Dependencies Added</div>
      </div>
      <div class="summary-item upgraded">
        <div class="summary-count">${upgradedCount}</div>
        <div>Dependencies Upgraded</div>
      </div>
      <div class="summary-item removed">
        <div class="summary-count">${removedCount}</div>
        <div>Dependencies Removed</div>
      </div>
      <div class="summary-item changelogs">
        <div class="summary-count">${changelogCount}</div>
        <div>Changelogs Generated</div>
      </div>
    </div>
    
    ${addedSection}
    ${upgradedSection}
    ${removedSection}
    
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
      <h2>Added Dependencies</h2>
      <p class="empty-message">No dependencies were added.</p>
    `;
  }
  
  const rows = added.map(dep => {
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
    <h2>Added Dependencies</h2>
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
 * Generate HTML section for upgraded dependencies
 * @param {Array} upgraded - Upgraded dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @returns {string} - HTML content
 */
const generateUpgradedSection = (upgraded, changelogs) => {
  if (upgraded.length === 0) {
    return `
      <h2>Upgraded Dependencies</h2>
      <p class="empty-message">No dependencies were upgraded.</p>
    `;
  }
  
  const rows = upgraded.map(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion}`;
    
    const changeTypeBadge = `<span class="badge ${dep.changeType}">${dep.changeType}</span>`;
    
    return `
      <tr>
        <td><a href="${npmUrl}" target="_blank">${dep.name}</a></td>
        <td><a href="${oldVersionUrl}" target="_blank">${dep.oldVersion}</a></td>
        <td><a href="${newVersionUrl}" target="_blank">${dep.newVersion}</a> ${changeTypeBadge}</td>
      </tr>
    `;
  }).join('');
  
  // Generate changelog sections
  const changelogSections = upgraded
    .filter(dep => changelogs[dep.name])
    .map(dep => {
      const changelog = changelogs[dep.name];
      const repoUrl = changelog.repoUrl.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
      
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
        <h3>${dep.name}: ${dep.oldVersion} → ${dep.newVersion}</h3>
        <div class="changelog">
          <p>Repository: <a href="${repoUrl}" target="_blank">${repoUrl}</a></p>
          <p>Commits: ${changelog.commits.length}</p>
          ${commits}
        </div>
      `;
    }).join('');
  
  return `
    <h2>Upgraded Dependencies</h2>
    <table>
      <thead>
        <tr>
          <th>Package</th>
          <th>Old Version</th>
          <th>New Version</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    
    <h2>Changelogs</h2>
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
      <h2>Removed Dependencies</h2>
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
    <h2>Removed Dependencies</h2>
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

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node generate-html.mjs <report.json> [output.html]');
      process.exit(1);
    }
    
    const [jsonPath, outputPath] = args;
    
    await generateHtmlReport(jsonPath, outputPath);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function if this file is executed directly
if (import.meta.url === `file://${fileURLToPath(import.meta.url)}`) {
  main();
}

export { generateHtmlReport };
