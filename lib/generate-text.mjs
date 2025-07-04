#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate text report from JSON report
 * @param {string} jsonPath - Path to the report.json file
 * @param {string} outputPath - Path to save the text report (optional)
 * @returns {Promise<string>} - Path to the generated text file
 */
const generateTextReport = async (jsonPath, outputPath = null) => {
  try {
    // Read the report JSON
    const reportJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    
    // If no output path specified, create one with a specific naming format
    if (!outputPath) {
      const packageName = reportJson.repository.split('/').pop().replace('.git', '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      outputPath = `dependency-report-${packageName}-${reportJson.olderVersion}-${reportJson.newerVersion}-${timestamp}.txt`;
    }
    
    // Generate text content
    const textContent = generateText(reportJson);
    
    // Write text file
    await writeFile(outputPath, textContent);
    
    console.log(`Text report generated at: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error generating text report: ${error.message}`);
    throw error;
  }
};

/**
 * Generate text content from report data
 * @param {Object} report - Report data
 * @returns {string} - Text content
 */
const generateText = (report) => {
  // Format repository URL for display
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
  output += `**Repository:** ${repoDisplayUrl}\n`;
  output += `**Comparing:** ${report.olderVersion} → ${report.newerVersion}\n`;
  output += `**Generated:** ${timestamp}\n`;
  if (report.namespace) {
    output += `**Nested dependencies filtered by namespace:** ${report.namespace}\n`;
  }
  output += '\n';
  
  // Summary
  output += '## Summary\n\n';
  output += `📦 **${addedCount}** dependencies added\n`;
  output += `⬆️ **${upgradedCount}** dependencies upgraded\n`;
  output += `🗑️ **${removedCount}** dependencies removed\n`;
  output += `🔄 **${modifiedCount}** dependencies modified (namespace changes)\n`;
  output += `📋 **${changelogCount}** changelogs generated\n`;
  if (errorCount > 0) {
    output += `❌ **${errorCount}** errors encountered\n`;
  }
  
  // Nested dependencies summary if available
  if (nestedAddedCount > 0 || nestedUpgradedCount > 0 || nestedRemovedCount > 0) {
    output += '\n### Nested Dependencies';
    if (report.namespace) {
      output += ` (Filtered by namespace: ${report.namespace})`;
    }
    output += '\n\n';
    output += `📦 **${nestedAddedCount}** nested dependencies added\n`;
    output += `⬆️ **${nestedUpgradedCount}** nested dependencies upgraded\n`;
    output += `🗑️ **${nestedRemovedCount}** nested dependencies removed\n`;
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
    output += generateNestedUpgradedSection(report.changes.nested.upgraded, report.changelogs);
    output += generateNestedRemovedSection(report.changes.nested.removed);
  }
  
  if (errorCount > 0) {
    output += generateErrorsSection(report.errors || {});
  }
  
  return output;
};

/**
 * Generate text section for added dependencies
 * @param {Array} added - Added dependencies
 * @returns {string} - Text content
 */
const generateAddedSection = (added) => {
  if (added.length === 0) {
    return '## 📦 Added Dependencies\n\nNo dependencies were added.\n\n';
  }
  
  let output = '## 📦 Added Dependencies\n\n';
  
  added.forEach(dep => {
    output += `• **${dep.name}** v${dep.version}\n`;
    if (dep.repository) {
      const repoUrl = dep.repository.replace(/\.git$/, '')
                                   .replace(/^git@github\.com:/, 'https://github.com/')
                                   .replace(/^git\+https:/, 'https:');
      output += `  Repository: ${repoUrl}\n`;
    }
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for upgraded dependencies
 * @param {Array} upgraded - Upgraded dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - Text content
 */
const generateUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return '## ⬆️ Upgraded Dependencies\n\nNo dependencies were upgraded.\n\n';
  }
  
  let output = '## ⬆️ Upgraded Dependencies\n\n';
  
  upgraded.forEach(dep => {
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    output += `• **${dep.name}** ${dep.oldVersion} → ${dep.newVersion} ${changeTypeEmoji[dep.changeType] || '⚪'} ${dep.changeType}\n`;
    
    if (dep.repository) {
      const repoUrl = dep.repository.replace(/\.git$/, '')
                                   .replace(/^git@github\.com:/, 'https://github.com/')
                                   .replace(/^git\+https:/, 'https:');
      output += `  Repository: ${repoUrl}\n`;
    }
    
    // Add CI status if available
    if (ciStatus[dep.name]) {
      const ci = ciStatus[dep.name];
      const statusEmoji = {
        'success': '✅',
        'failure': '❌',
        'in_progress': '🔄',
        'cancelled': '⚪',
        'no_workflows': '➖',
        'unknown': '❓',
        'error': '⚠️'
      };
      
      output += `  ${statusEmoji[ci.status] || '❓'} CI Status: ${ci.status}`;
      
      if (ci.commitSha) {
        output += ` (${ci.commitSha})`;
      }
      
      if (ci.totalRuns) {
        output += ` - ${ci.totalRuns} workflow runs`;
      }
      
      if (ci.actionsUrl) {
        output += `\n  GitHub Actions: ${ci.actionsUrl}`;
      }
      
      output += '\n';
    }
    
    // Add changelog info if available
    if (changelogs[dep.name]) {
      const changelog = changelogs[dep.name];
      output += `  📋 ${changelog.commits.length} commits in changelog\n`;
    }
  });
  
  output += '\n';
  
  // Generate detailed changelogs
  const changelogDeps = upgraded.filter(dep => changelogs[dep.name]);
  if (changelogDeps.length > 0) {
    output += '### 📋 Detailed Changelogs\n\n';
    
    changelogDeps.forEach(dep => {
      const changelog = changelogs[dep.name];
      const repoUrl = changelog.repoUrl.replace(/\.git$/, '')
                                      .replace(/^git@github\.com:/, 'https://github.com/')
                                      .replace(/^git\+https:/, 'https:');
      
      output += `#### ${dep.name}: ${dep.oldVersion} → ${dep.newVersion}\n\n`;
      output += `Repository: ${repoUrl}\n`;
      output += `Commits: ${changelog.commits.length}\n\n`;
      
      changelog.commits.forEach(commit => {
        const commitUrl = `${repoUrl}/commit/${commit.hash}`;
        output += `• \`${commit.hash.substring(0, 7)}\` ${commit.message}\n`;
        output += `  by ${commit.author} on ${commit.date}\n`;
        output += `  ${commitUrl}\n\n`;
      });
    });
  }
  
  return output;
};

/**
 * Generate text section for removed dependencies
 * @param {Array} removed - Removed dependencies
 * @returns {string} - Text content
 */
const generateRemovedSection = (removed) => {
  if (removed.length === 0) {
    return '## 🗑️ Removed Dependencies\n\nNo dependencies were removed.\n\n';
  }
  
  let output = '## 🗑️ Removed Dependencies\n\n';
  
  removed.forEach(dep => {
    output += `• **${dep.name}** v${dep.version}\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for modified dependencies (namespace changes)
 * @param {Array} modified - Modified dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @returns {string} - Text content
 */
const generateModifiedSection = (modified, changelogs = {}) => {
  if (modified.length === 0) {
    return '## 🔄 Modified Dependencies (Namespace Changes)\n\nNo dependencies had namespace changes.\n\n';
  }
  
  let output = '## 🔄 Modified Dependencies (Namespace Changes)\n\n';
  output += 'These dependencies have changed their package name (typically from/to a namespace):\n\n';
  
  modified.forEach(dep => {
    output += `• **${dep.oldName}** → **${dep.newName}**\n`;
    output += `  Version: ${dep.oldVersion} → ${dep.newVersion}\n`;
    
    // Add changelog info if available
    if (changelogs[dep.newName]) {
      const changelog = changelogs[dep.newName];
      output += `  📋 ${changelog.commits.length} commits in changelog\n`;
    }
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for nested added dependencies
 * @param {Array} added - Added nested dependencies
 * @returns {string} - Text content
 */
const generateNestedAddedSection = (added) => {
  if (added.length === 0) {
    return '';
  }
  
  let output = '## 📦 Nested Added Dependencies\n\n';
  
  added.forEach(dep => {
    output += `• **${dep.name}** v${dep.version} (via ${dep.parent})\n`;
    if (dep.repository) {
      const repoUrl = dep.repository.replace(/\.git$/, '')
                                   .replace(/^git@github\.com:/, 'https://github.com/')
                                   .replace(/^git\+https:/, 'https:');
      output += `  Repository: ${repoUrl}\n`;
    }
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for nested upgraded dependencies
 * @param {Array} upgraded - Upgraded nested dependencies
 * @param {Object} changelogs - Changelogs for dependencies
 * @param {Object} ciStatus - CI status for dependencies
 * @returns {string} - Text content
 */
const generateNestedUpgradedSection = (upgraded, changelogs, ciStatus = {}) => {
  if (upgraded.length === 0) {
    return '';
  }
  
  let output = '## ⬆️ Nested Upgraded Dependencies\n\n';
  
  upgraded.forEach(dep => {
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    output += `• **${dep.name}** ${dep.oldVersion} → ${dep.newVersion} ${changeTypeEmoji[dep.changeType] || '⚪'} ${dep.changeType} (via ${dep.parent})\n`;
    
    if (dep.repository) {
      const repoUrl = dep.repository.replace(/\.git$/, '')
                                   .replace(/^git@github\.com:/, 'https://github.com/')
                                   .replace(/^git\+https:/, 'https:');
      output += `  Repository: ${repoUrl}\n`;
    }
    
    // Add changelog info if available
    if (changelogs[dep.name]) {
      const changelog = changelogs[dep.name];
      output += `  📋 ${changelog.commits.length} commits in changelog\n`;
    }
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for nested removed dependencies
 * @param {Array} removed - Removed nested dependencies
 * @returns {string} - Text content
 */
const generateNestedRemovedSection = (removed) => {
  if (removed.length === 0) {
    return '';
  }
  
  let output = '## 🗑️ Nested Removed Dependencies\n\n';
  
  removed.forEach(dep => {
    output += `• **${dep.name}** v${dep.version} (was via ${dep.parent})\n`;
  });
  
  output += '\n';
  return output;
};

/**
 * Generate text section for errors encountered
 * @param {Object} errors - Errors object
 * @returns {string} - Text content
 */
const generateErrorsSection = (errors) => {
  const errorCount = Object.keys(errors).length;
  
  if (errorCount === 0) {
    return '## ❌ Errors\n\nNo errors were encountered.\n\n';
  }
  
  let output = '## ❌ Errors\n\n';
  output += 'The following dependencies encountered errors during changelog generation:\n\n';
  
  Object.entries(errors).forEach(([name, info]) => {
    const repoUrl = info.repoUrl.replace(/\.git$/, '')
                               .replace(/^git@github\.com:/, 'https://github.com/')
                               .replace(/^git\+https:/, 'https:');
    
    output += `• **${name}** (${info.oldVersion} → ${info.newVersion})\n`;
    output += `  Repository: ${repoUrl}\n`;
    output += `  Error: ${info.error}\n\n`;
  });
  
  return output;
};

export { generateTextReport };
