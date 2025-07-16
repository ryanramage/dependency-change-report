#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { basename } from 'path';

/**
 * Generate CHANGELOG-style report from JSON report using LLM summarization
 * @param {string} jsonPath - Path to the report.json file
 * @param {string} outputPath - Path to save the changelog (optional)
 * @param {string} llmCommand - LLM command to use for summarization (default: ollama)
 * @returns {Promise<string>} - Path to the generated changelog file
 */
const generateChangelogReport = async (jsonPath, outputPath = null, llmCommand = 'ollama') => {
  try {
    // Read the report JSON
    const reportJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    
    // If no output path specified, create one
    if (!outputPath) {
      const packageName = reportJson.repository.split('/').pop().replace('.git', '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      // Sanitize version names to remove invalid filename characters
      const sanitizedOlderVersion = reportJson.olderVersion.replace(/[\/\\:*?"<>|]/g, '-');
      const sanitizedNewerVersion = reportJson.newerVersion.replace(/[\/\\:*?"<>|]/g, '-');
      outputPath = `CHANGELOG-${packageName}-${sanitizedOlderVersion}-${sanitizedNewerVersion}-${timestamp}.md`;
    }
    
    // Generate changelog content
    const changelogContent = await generateChangelog(reportJson, llmCommand);
    
    // Write changelog file
    await writeFile(outputPath, changelogContent);
    
    console.log(`Changelog generated at: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error generating changelog: ${error.message}`);
    throw error;
  }
};

/**
 * Generate changelog content from report data with LLM summarization
 * @param {Object} report - Report data
 * @param {string} llmCommand - LLM command to use
 * @returns {Promise<string>} - Changelog content
 */
const generateChangelog = async (report, llmCommand) => {
  // Format repository URL for display
  const repoUrl = report.repository.replace(/\.git$/, '');
  const repoDisplayUrl = repoUrl.replace(/^git@github\.com:/, 'https://github.com/')
                               .replace(/^git\+https:/, 'https:');
  
  // Format timestamp
  const timestamp = new Date(report.timestamp).toLocaleString();
  
  let output = '';
  
  // Header
  output += `# Dependencies Updated\n\n`;
  output += `**Repository:** ${repoDisplayUrl}\n`;
  output += `**Version Change:** ${report.olderVersion} → ${report.newerVersion}\n`;
  output += `**Generated:** ${timestamp}\n\n`;
  
  // Process all dependency changes
  const allChanges = [];
  
  // Added dependencies
  if (report.changes.added.length > 0) {
    report.changes.added.forEach(dep => {
      allChanges.push({
        type: 'added',
        name: dep.name,
        version: dep.version,
        oldVersion: null,
        newVersion: dep.version,
        commits: []
      });
    });
  }
  
  // Upgraded dependencies
  if (report.changes.upgraded.length > 0) {
    report.changes.upgraded.forEach(dep => {
      const changelog = report.changelogs[dep.name];
      const commits = changelog ? filterVersionBumpCommits(changelog.commits) : [];
      
      allChanges.push({
        type: 'upgraded',
        name: dep.name,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        changeType: dep.changeType,
        commits: commits
      });
    });
  }
  
  // Removed dependencies
  if (report.changes.removed.length > 0) {
    report.changes.removed.forEach(dep => {
      allChanges.push({
        type: 'removed',
        name: dep.name,
        version: dep.version,
        oldVersion: dep.version,
        newVersion: null,
        commits: []
      });
    });
  }
  
  // Modified dependencies (namespace changes)
  if (report.changes.modified && report.changes.modified.length > 0) {
    report.changes.modified.forEach(dep => {
      const changelog = report.changelogs[dep.newName];
      const commits = changelog ? filterVersionBumpCommits(changelog.commits) : [];
      
      allChanges.push({
        type: 'modified',
        name: dep.newName,
        oldName: dep.oldName,
        oldVersion: dep.oldVersion,
        newVersion: dep.newVersion,
        commits: commits
      });
    });
  }
  
  // Sort changes by name for consistent output
  allChanges.sort((a, b) => a.name.localeCompare(b.name));
  
  // Generate sections for each change
  console.log(`Processing ${allChanges.length} dependency changes...`);
  for (let i = 0; i < allChanges.length; i++) {
    const change = allChanges[i];
    console.log(`[${i + 1}/${allChanges.length}] Processing ${change.name}...`);
    output += await generateChangeSection(change, llmCommand);
  }
  
  // Add nested dependencies if available
  if (report.changes.nested) {
    const nestedChanges = [];
    
    // Process nested changes
    if (report.changes.nested.added.length > 0) {
      report.changes.nested.added.forEach(dep => {
        nestedChanges.push({
          type: 'added',
          name: dep.name,
          version: dep.version,
          parent: dep.parent,
          commits: []
        });
      });
    }
    
    if (report.changes.nested.upgraded.length > 0) {
      report.changes.nested.upgraded.forEach(dep => {
        const changelog = report.changelogs[dep.name];
        const commits = changelog ? filterVersionBumpCommits(changelog.commits) : [];
        
        nestedChanges.push({
          type: 'upgraded',
          name: dep.name,
          oldVersion: dep.oldVersion,
          newVersion: dep.newVersion,
          parent: dep.parent,
          changeType: dep.changeType,
          commits: commits
        });
      });
    }
    
    if (report.changes.nested.removed.length > 0) {
      report.changes.nested.removed.forEach(dep => {
        nestedChanges.push({
          type: 'removed',
          name: dep.name,
          version: dep.version,
          parent: dep.parent,
          commits: []
        });
      });
    }
    
    if (nestedChanges.length > 0) {
      output += '\n## Nested Dependencies\n\n';
      
      nestedChanges.sort((a, b) => a.name.localeCompare(b.name));
      
      console.log(`Processing ${nestedChanges.length} nested dependency changes...`);
      for (let i = 0; i < nestedChanges.length; i++) {
        const change = nestedChanges[i];
        console.log(`[${i + 1}/${nestedChanges.length}] Processing nested ${change.name}...`);
        output += await generateNestedChangeSection(change, llmCommand);
      }
    }
  }
  
  return output;
};

/**
 * Generate a section for a single dependency change
 * @param {Object} change - Change information
 * @param {string} llmCommand - LLM command to use
 * @returns {Promise<string>} - Section content
 */
const generateChangeSection = async (change, llmCommand) => {
  let output = '';
  
  // Generate header based on change type
  if (change.type === 'added') {
    output += `### ➕ ${change.name} ${change.newVersion}\n`;
    output += `*New dependency added*\n\n`;
  } else if (change.type === 'removed') {
    output += `### ➖ ${change.name} ${change.oldVersion}\n`;
    output += `*Dependency removed*\n\n`;
  } else if (change.type === 'modified') {
    output += `### 🔄 ${change.oldName} → ${change.name}\n`;
    output += `*Package renamed: ${change.oldVersion} → ${change.newVersion}*\n\n`;
  } else if (change.type === 'upgraded') {
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    output += `### ⬆️ ${change.name} ${change.oldVersion} → ${change.newVersion}\n`;
    output += `*${changeTypeEmoji[change.changeType] || '⚪'} ${change.changeType} update*\n\n`;
  }
  
  // If there are commits, summarize them with LLM
  if (change.commits && change.commits.length > 0) {
    try {
      console.log(`  Summarizing ${change.commits.length} commits with LLM...`);
      const summary = await summarizeCommits(change.commits, llmCommand);
      output += summary + '\n\n';
    } catch (error) {
      console.warn(`  Failed to summarize commits for ${change.name}: ${error.message}`);
      console.log(`  Falling back to simple commit list...`);
      // Fallback to simple commit list
      output += generateSimpleCommitList(change.commits) + '\n\n';
    }
  }
  
  return output;
};

/**
 * Generate a section for a nested dependency change
 * @param {Object} change - Change information
 * @param {string} llmCommand - LLM command to use
 * @returns {Promise<string>} - Section content
 */
const generateNestedChangeSection = async (change, llmCommand) => {
  let output = '';
  
  // Generate header based on change type
  if (change.type === 'added') {
    output += `#### ➕ ${change.name} ${change.newVersion || change.version} *(via ${change.parent})*\n`;
  } else if (change.type === 'removed') {
    output += `#### ➖ ${change.name} ${change.version} *(was via ${change.parent})*\n`;
  } else if (change.type === 'upgraded') {
    const changeTypeEmoji = {
      'major': '🔴',
      'minor': '🟡', 
      'patch': '🟢',
      'unknown': '⚪'
    };
    
    output += `#### ⬆️ ${change.name} ${change.oldVersion} → ${change.newVersion} *(via ${change.parent})*\n`;
    output += `*${changeTypeEmoji[change.changeType] || '⚪'} ${change.changeType} update*\n\n`;
  }
  
  // If there are commits, summarize them with LLM
  if (change.commits && change.commits.length > 0) {
    try {
      console.log(`    Summarizing ${change.commits.length} commits with LLM...`);
      const summary = await summarizeCommits(change.commits, llmCommand);
      output += summary + '\n\n';
    } catch (error) {
      console.warn(`    Failed to summarize commits for ${change.name}: ${error.message}`);
      console.log(`    Falling back to simple commit list...`);
      // Fallback to simple commit list
      output += generateSimpleCommitList(change.commits) + '\n\n';
    }
  } else {
    output += '\n';
  }
  
  return output;
};

/**
 * Filter out version bump commits from commit list
 * @param {Array} commits - Array of commit objects
 * @returns {Array} - Filtered commits
 */
const filterVersionBumpCommits = (commits) => {
  const versionBumpPatterns = [
    /^bump version to/i,
    /^version bump/i,
    /^v?\d+\.\d+\.\d+$/,
    /^release v?\d+\.\d+\.\d+/i,
    /^chore.*bump.*version/i,
    /^chore.*version.*bump/i,
    /^\d+\.\d+\.\d+$/,
    /^prepare.*release/i,
    /^release.*\d+\.\d+\.\d+/i,
    /^update.*version/i,
    /^version.*update/i
  ];
  
  return commits.filter(commit => {
    const message = commit.message.trim();
    return !versionBumpPatterns.some(pattern => pattern.test(message));
  });
};

/**
 * Summarize commits using LLM
 * @param {Array} commits - Array of commit objects
 * @param {string} llmCommand - LLM command to use
 * @returns {Promise<string>} - Summarized content
 */
const summarizeCommits = async (commits, llmCommand) => {
  if (commits.length === 0) {
    return '';
  }
  
  // Prepare commit messages for LLM
  const commitMessages = commits.map(commit => 
    `${commit.hash.substring(0, 7)}: ${commit.message}`
  ).join('\n');
  
  const prompt = `Please summarize the following git commits into concise bullet points for a CHANGELOG. Focus on user-facing changes, bug fixes, and new features. Ignore internal refactoring unless it's significant. Format as markdown bullet points:

${commitMessages}

Provide a concise summary in bullet point format:`;

  return new Promise((resolve, reject) => {
    // Set a timeout for the LLM call (2 minutes)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('LLM command timed out after 2 minutes'));
    }, 120000);

    const child = spawn('ollama', ['run', 'granite3-moe', prompt], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let error = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        // Clean up the output
        const cleaned = output.trim()
          .replace(/^```markdown\n?/gm, '')
          .replace(/^```\n?/gm, '')
          .replace(/\n```$/gm, '');
        resolve(cleaned);
      } else {
        reject(new Error(`LLM command failed with code ${code}: ${error}`));
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn LLM command: ${err.message}`));
    });

    // Write the prompt to stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();
  });
};

/**
 * Generate simple commit list as fallback
 * @param {Array} commits - Array of commit objects
 * @returns {string} - Simple commit list
 */
const generateSimpleCommitList = (commits) => {
  if (commits.length === 0) {
    return '';
  }
  
  return commits.map(commit => 
    `- ${commit.message} (\`${commit.hash.substring(0, 7)}\`)`
  ).join('\n');
};

export { generateChangelogReport };
