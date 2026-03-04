#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate Markdown report from JSON report
 * @param {string} jsonPath - Path to the report.json file
 * @param {string} outputPath - Path to save the Markdown report (optional)
 * @returns {Promise<string>} - Path to the generated Markdown file
 */
const generateMarkdownReport = async (jsonPath, outputPath = null) => {
  try {
    // Read the report JSON
    const reportJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    
    // If no output path specified, create one with a specific naming format
    if (!outputPath) {
      const packageName = reportJson.repository.split('/').pop().replace('.git', '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      outputPath = `dependency-report-${packageName}-${reportJson.olderVersion}-${reportJson.newerVersion}-${timestamp}.md`;
    }
    
    // Generate Markdown content
    const markdownContent = generateMarkdown(reportJson);
    
    // Write Markdown file
    await writeFile(outputPath, markdownContent);
    
    console.log(`Markdown report generated at: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error generating Markdown report: ${error.message}`);
    throw error;
  }
};

/**
 * Generate Markdown content from report data
 * @param {Object} report - Report data
 * @returns {string} - Markdown content
 */
const generateMarkdown = (report) => {
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
  
  // Format timestamp
  const timestamp = new Date(report.timestamp).toLocaleString();
  
  let output = '';
  
  // Header
  output += '# Dependency Changes Report\n\n';
  output += `**Repository:** [${repoDisplayUrl}](${repoDisplayUrl})\n`;
  output += `**Comparing:** ${report.olderVersion} → ${report.newerVersion}\n`;
  output += `**Generated:** ${timestamp}\n`;
  if (report.namespace) {
    output += `**Nested dependencies filtered by namespace:** ${report.namespace}\n`;
  }
  output += '\n';
  
  // Summary
  output += '## Summary\n\n';
  output += `| Type | Count |\n`;
  output += `|------|-------|\n`;
  output += `| 📦 Dependencies Added | **${addedCount}** |\n`;
  output += `| ⬆️ Dependencies Upgraded | **${upgradedCount}** |\n`;
  output += `| 🗑️ Dependencies Removed | **${removedCount}** |\n`;
  output += `| 🔄 Dependencies Modified | **${modifiedCount}** |\n`;
  output += `| 📋 Changelogs Generated | **${changelogCount}** |\n`;
  if (errorCount > 0) {
    output += `| ❌ Errors Encountered | **${errorCount}** |\n`;
  }
  
  // Nested dependencies summary if available
  if (nestedAddedCount > 0 || nestedUpgradedCount > 0 || nestedRemovedCount > 0) {
    output += '\n### Nested Dependencies';
    if (report.namespace) {
      output += ` (Filtered by namespace: ${report.namespace})`;
    }
    output += '\n\n';
    output += `| Type | Count |\n`;
    output += `|------|-------|\n`;
    output += `| 📦 Nested Dependencies Added | **${nestedAddedCount}** |\n`;
    output += `| ⬆️ Nested Dependencies Upgraded | **${nestedUpgradedCount}** |\n`;
    output += `| 🗑️ Nested Dependencies Removed | **${nestedRemovedCount}** |\n`;
  }
  
  output += '\n';
  
  // Generate sections
  output += generateAddedSection(report.changes.added);
  output += generateUpgradedSection(report.changes.upgraded, report.changelogs, report.ciStatus);
  output += generateRemovedSection(report.changes.removed);
  output += generateModifiedSection(report.changes.modified || [], report.changelogs);
  
  // Generate nested dependency sections if available
  if (report.changes.nested) {
    output += generateNestedAddedSection(report.changes.nested.added);
    output += generateNestedUpgradedSection(report.changes.nested.upgraded, report.changelogs, report.ciStatus);
    output += generateNestedRemovedSection(report.changes.nested.removed);
  }
  
  // Generate full inventory section if available
  if (report.fullInventory && report.fullInventory.length > 0) {
    output += generateFullInventorySection(report.fullInventory);
  }
  
  if (errorCount > 0) {
    output += generateErrorsSection(report.errors || {});
  }
  
  return output;
};

/**
 * Generate Markdown section for added dependencies
 * @param {Array} added - Added dependencies
 * @returns {string} - Markdown content
 */
const generateAddedSection = (added) => {
  if (added.length === 0) {
    return '## 📦 Added Dependencies\n\nNo dependencies were added.\n\n';
  }
  
  let output = '## 📦 Added Dependencies\n\n';
  output += '| Package | Version | Repository |\n';
  output += '|---------|---------|------------|\n';
  
  added.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const repoUrl = (dep.repository && typeof dep.repository === 'string') ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      null;
    
    output += `| [${dep.name}](${npmUrl}) | [${dep.version}](${versionUrl}) | ${repoUrl ? `[${repoUrl}](${repoUrl})` : 'N/A'} |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for upgraded dependencies
 * @param {Array} upgraded - Upgraded dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - Markdown content
 */
const generateUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return '## ⬆️ Upgraded Dependencies\n\nNo dependencies were upgraded.\n\n';
  }
  
  let output = '## ⬆️ Upgraded Dependencies\n\n';
  output += '| Package | Old Version | New Version | Repository | CI Status | Changelog |\n';
  output += '|---------|-------------|-------------|------------|-----------|----------|\n';
  
  upgraded.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion}`;
    const repoUrl = (dep.repository && typeof dep.repository === 'string') ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      (changelogs[dep.name] && changelogs[dep.name].repoUrl && typeof changelogs[dep.name].repoUrl === 'string') ? 
        changelogs[dep.name].repoUrl.replace(/\.git$/, '')
                            .replace(/^git@github\.com:/, 'https://github.com/')
                            .replace(/^git\+https:/, 'https:') : 
        null;
      
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    // Generate CI status badge
    const ciInfo = ciStatus[dep.name];
    let ciStatusCell = 'N/A';
    if (ciInfo && ciInfo.latestRun) {
      const statusEmoji = {
        'success': '✅',
        'failure': '❌',
        'in_progress': '🔄',
        'cancelled': '⚪',
        'no_workflows': '➖',
        'unknown': '❓',
        'error': '⚠️'
      };
      ciStatusCell = `[${statusEmoji[ciInfo.status] || '❓'} ${ciInfo.status}](${ciInfo.latestRun.url})`;
    } else if (ciInfo) {
      const statusEmoji = {
        'success': '✅',
        'failure': '❌',
        'in_progress': '🔄',
        'cancelled': '⚪',
        'no_workflows': '➖',
        'unknown': '❓',
        'error': '⚠️'
      };
      ciStatusCell = `${statusEmoji[ciInfo.status] || '❓'} ${ciInfo.status}`;
    }
      
    // Add changelog link if available
    const changelogLink = changelogs[dep.name] ? 
      `[📋 View](#${dep.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-changelog)` : 
      'N/A';
      
    output += `| [${dep.name}](${npmUrl}) | [${dep.oldVersion}](${oldVersionUrl}) | [${dep.newVersion}](${newVersionUrl}) ${changeTypeEmoji[dep.changeType] || '⚪'} ${dep.changeType} | ${repoUrl ? `[${repoUrl}](${repoUrl})` : 'N/A'} | ${ciStatusCell} | ${changelogLink} |\n`;
  });
  
  output += '\n';
  
  // Generate changelog sections
  const changelogDeps = upgraded.filter(dep => changelogs[dep.name]);
  if (changelogDeps.length > 0) {
    output += '## 📋 Changelogs\n\n';
    
    changelogDeps.forEach(dep => {
      const changelog = changelogs[dep.name];
      const repoUrl = (changelog.repoUrl && typeof changelog.repoUrl === 'string') ? 
        changelog.repoUrl.replace(/\.git$/, '')
                         .replace(/^git@github\.com:/, 'https://github.com/')
                         .replace(/^git\+https:/, 'https:') :
        '#';
      
      output += `### ${dep.name}: ${dep.oldVersion} → ${dep.newVersion} {#${dep.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-changelog}\n\n`;
      output += `**Repository:** [${repoUrl}](${repoUrl})\n`;
      output += `**Commits:** ${changelog.commits.length}\n\n`;
      
      changelog.commits.forEach(commit => {
        const commitUrl = `${repoUrl}/commit/${commit.hash}`;
        output += `- [\`${commit.hash.substring(0, 7)}\`](${commitUrl}) ${commit.message}\n`;
        output += `  *by ${commit.author} on ${commit.date}*\n\n`;
      });
    });
  }
  
  return output;
};

/**
 * Generate Markdown section for removed dependencies
 * @param {Array} removed - Removed dependencies
 * @returns {string} - Markdown content
 */
const generateRemovedSection = (removed) => {
  if (removed.length === 0) {
    return '## 🗑️ Removed Dependencies\n\nNo dependencies were removed.\n\n';
  }
  
  let output = '## 🗑️ Removed Dependencies\n\n';
  output += '| Package | Version |\n';
  output += '|---------|----------|\n';
  
  removed.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    
    output += `| [${dep.name}](${npmUrl}) | [${dep.version}](${versionUrl}) |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for modified dependencies (namespace changes)
 * @param {Array} modified - Modified dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @returns {string} - Markdown content
 */
const generateModifiedSection = (modified, changelogs = {}) => {
  if (modified.length === 0) {
    return '## 🔄 Modified Dependencies (Namespace Changes)\n\nNo dependencies had namespace changes.\n\n';
  }
  
  let output = '## 🔄 Modified Dependencies (Namespace Changes)\n\n';
  output += 'These dependencies have changed their package name (typically from/to a namespace):\n\n';
  output += '| Old Package | New Package | Old Version | New Version | Changelog |\n';
  output += '|-------------|-------------|-------------|-------------|----------|\n';
  
  modified.forEach(dep => {
    const oldNpmUrl = `https://www.npmjs.com/package/${dep.oldName}`;
    const newNpmUrl = `https://www.npmjs.com/package/${dep.newName}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.oldName}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.newName}/v/${dep.newVersion}`;
    
    // Add changelog link if available
    const changelogLink = changelogs[dep.newName] ? 
      `[📋 View](#${dep.newName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-changelog)` : 
      'N/A';
    
    output += `| [${dep.oldName}](${oldNpmUrl}) | [${dep.newName}](${newNpmUrl}) | [${dep.oldVersion}](${oldVersionUrl}) | [${dep.newVersion}](${newVersionUrl}) | ${changelogLink} |\n`;
  });
  
  output += '\n';
  
  // Generate changelog sections for modified dependencies
  const changelogDeps = modified.filter(dep => changelogs[dep.newName]);
  if (changelogDeps.length > 0) {
    output += '### Changelogs for Modified Dependencies\n\n';
    
    changelogDeps.forEach(dep => {
      const changelog = changelogs[dep.newName];
      const repoUrl = (changelog.repoUrl && typeof changelog.repoUrl === 'string') ? 
        changelog.repoUrl.replace(/\.git$/, '')
                         .replace(/^git@github\.com:/, 'https://github.com/')
                         .replace(/^git\+https:/, 'https:') :
        '#';
      
      output += `#### ${dep.oldName} → ${dep.newName}: ${dep.oldVersion} → ${dep.newVersion} {#${dep.newName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-changelog}\n\n`;
      output += `**Repository:** [${repoUrl}](${repoUrl})\n`;
      output += `**Commits:** ${changelog.commits.length}\n\n`;
      
      changelog.commits.forEach(commit => {
        const commitUrl = `${repoUrl}/commit/${commit.hash}`;
        output += `- [\`${commit.hash.substring(0, 7)}\`](${commitUrl}) ${commit.message}\n`;
        output += `  *by ${commit.author} on ${commit.date}*\n\n`;
      });
    });
  }
  
  return output;
};

/**
 * Generate Markdown section for nested added dependencies
 * @param {Array} added - Added nested dependencies
 * @returns {string} - Markdown content
 */
const generateNestedAddedSection = (added) => {
  if (added.length === 0) {
    return '';
  }
  
  let output = '## 📦 Nested Added Dependencies\n\n';
  output += '| Package | Version | Parent Package | Repository |\n';
  output += '|---------|---------|----------------|------------|\n';
  
  added.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    const repoUrl = (dep.repository && typeof dep.repository === 'string') ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      null;
    
    output += `| [${dep.name}](${npmUrl}) | [${dep.version}](${versionUrl}) | [${dep.parent}](${parentUrl}) | ${repoUrl ? `[${repoUrl}](${repoUrl})` : 'N/A'} |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for nested upgraded dependencies
 * @param {Array} upgraded - Upgraded nested dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - Markdown content
 */
const generateNestedUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return '';
  }
  
  let output = '## ⬆️ Nested Upgraded Dependencies\n\n';
  output += '| Package | Old Version | New Version | Parent Package | Repository | CI Status | Changelog |\n';
  output += '|---------|-------------|-------------|----------------|------------|-----------|----------|\n';
  
  upgraded.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion}`;
    const newVersionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    const repoUrl = (dep.repository && typeof dep.repository === 'string') ? 
      dep.repository.replace(/\.git$/, '')
                   .replace(/^git@github\.com:/, 'https://github.com/')
                   .replace(/^git\+https:/, 'https:') : 
      (changelogs[dep.name] && changelogs[dep.name].repoUrl && typeof changelogs[dep.name].repoUrl === 'string') ? 
        changelogs[dep.name].repoUrl.replace(/\.git$/, '')
                            .replace(/^git@github\.com:/, 'https://github.com/')
                            .replace(/^git\+https:/, 'https:') : 
        null;
      
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    // Generate CI status badge
    const ciInfo = ciStatus[dep.name];
    let ciStatusCell = 'N/A';
    if (ciInfo && ciInfo.latestRun) {
      const statusEmoji = {
        'success': '✅',
        'failure': '❌',
        'in_progress': '🔄',
        'cancelled': '⚪',
        'no_workflows': '➖',
        'unknown': '❓',
        'error': '⚠️'
      };
      ciStatusCell = `[${statusEmoji[ciInfo.status] || '❓'} ${ciInfo.status}](${ciInfo.latestRun.url})`;
    } else if (ciInfo) {
      const statusEmoji = {
        'success': '✅',
        'failure': '❌',
        'in_progress': '🔄',
        'cancelled': '⚪',
        'no_workflows': '➖',
        'unknown': '❓',
        'error': '⚠️'
      };
      ciStatusCell = `${statusEmoji[ciInfo.status] || '❓'} ${ciInfo.status}`;
    }
      
    // Add changelog link if available
    const changelogLink = changelogs[dep.name] ? 
      `[📋 View](#${dep.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-changelog)` : 
      'N/A';
      
    output += `| [${dep.name}](${npmUrl}) | [${dep.oldVersion}](${oldVersionUrl}) | [${dep.newVersion}](${newVersionUrl}) ${changeTypeEmoji[dep.changeType] || '⚪'} ${dep.changeType} | [${dep.parent}](${parentUrl}) | ${repoUrl ? `[${repoUrl}](${repoUrl})` : 'N/A'} | ${ciStatusCell} | ${changelogLink} |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for nested removed dependencies
 * @param {Array} removed - Removed nested dependencies
 * @returns {string} - Markdown content
 */
const generateNestedRemovedSection = (removed) => {
  if (removed.length === 0) {
    return '';
  }
  
  let output = '## 🗑️ Nested Removed Dependencies\n\n';
  output += '| Package | Version | Parent Package |\n';
  output += '|---------|---------|----------------|\n';
  
  removed.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const versionUrl = `https://www.npmjs.com/package/${dep.name}/v/${dep.version}`;
    const parentUrl = `https://www.npmjs.com/package/${dep.parent}`;
    
    output += `| [${dep.name}](${npmUrl}) | [${dep.version}](${versionUrl}) | [${dep.parent}](${parentUrl}) |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for full dependency inventory
 * @param {Array} inventory - Full dependency inventory
 * @returns {string} - Markdown content
 */
const generateFullInventorySection = (inventory) => {
  if (!inventory || inventory.length === 0) {
    return '';
  }
  
  // Count conflicts
  const oldConflicts = inventory.filter(i => i.hasOldConflict).length;
  const newConflicts = inventory.filter(i => i.hasNewConflict).length;
  
  let output = '## 📊 Full Dependency Inventory\n\n';
  output += 'Complete list of all dependencies in both versions:\n\n';
  
  if (oldConflicts > 0 || newConflicts > 0) {
    output += '**⚠️ Version Conflicts Detected:**\n';
    if (oldConflicts > 0) {
      output += `- ${oldConflicts} package(s) with conflicts in older version\n`;
    }
    if (newConflicts > 0) {
      output += `- ${newConflicts} package(s) with conflicts in newer version\n`;
    }
    output += '\n';
  }
  
  output += '| Package | Old Version | New Version | Status |\n';
  output += '|---------|-------------|-------------|--------|\n';
  
  inventory.forEach(dep => {
    const npmUrl = `https://www.npmjs.com/package/${dep.name}`;
    const oldVersionDisplay = dep.oldVersion || '-';
    const newVersionDisplay = dep.newVersion || '-';
    
    let statusEmoji = '';
    let statusText = '';
    
    if (!dep.oldVersion && dep.newVersion) {
      statusEmoji = '📦';
      statusText = 'Added';
    } else if (dep.oldVersion && !dep.newVersion) {
      statusEmoji = '🗑️';
      statusText = 'Removed';
    } else if (dep.oldVersion !== dep.newVersion) {
      statusEmoji = '⬆️';
      statusText = 'Upgraded';
    } else {
      statusEmoji = '✓';
      statusText = 'Unchanged';
    }
    
    // Add conflict indicators
    if (dep.hasOldConflict || dep.hasNewConflict) {
      statusText += ' ⚠️';
    }
    
    const oldVersionCell = dep.oldVersion ? 
      `[${oldVersionDisplay}](https://www.npmjs.com/package/${dep.name}/v/${dep.oldVersion})` : 
      oldVersionDisplay;
    const newVersionCell = dep.newVersion ? 
      `[${newVersionDisplay}](https://www.npmjs.com/package/${dep.name}/v/${dep.newVersion})` : 
      newVersionDisplay;
    
    output += `| [${dep.name}](${npmUrl}) | ${oldVersionCell} | ${newVersionCell} | ${statusEmoji} ${statusText} |\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate Markdown section for errors encountered
 * @param {Object} errors - Errors object
 * @returns {string} - Markdown content
 */
const generateErrorsSection = (errors) => {
  const errorCount = Object.keys(errors).length;
  
  if (errorCount === 0) {
    return '## ❌ Errors\n\nNo errors were encountered.\n\n';
  }
  
  let output = '## ❌ Errors\n\n';
  output += 'The following dependencies encountered errors during changelog generation:\n\n';
  output += '| Package | Repository | Version Change | Error |\n';
  output += '|---------|------------|----------------|-------|\n';
  
  Object.entries(errors).forEach(([name, info]) => {
    const npmUrl = `https://www.npmjs.com/package/${name}`;
    const repoUrl = (info.repoUrl && typeof info.repoUrl === 'string') ? 
      info.repoUrl.replace(/\.git$/, '')
                  .replace(/^git@github\.com:/, 'https://github.com/')
                  .replace(/^git\+https:/, 'https:') :
      '#';
    
    // Escape pipe characters in error messages for table formatting
    const escapedError = info.error.replace(/\|/g, '\\|');
    
    output += `| [${name}](${npmUrl}) | [${repoUrl}](${repoUrl}) | ${info.oldVersion} → ${info.newVersion} | ${escapedError} |\n`;
  });
  
  output += '\n';
  return output;
};

export { generateMarkdownReport };
