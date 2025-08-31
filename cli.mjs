#!/usr/bin/env node

import { analyzeDependencyChanges } from './lib/index.mjs';
import { generateHtmlReport } from './lib/generate-html.mjs';
import { generateTextReport } from './lib/generate-text.mjs';
import { generateMarkdownReport } from './lib/generate-markdown.mjs';
import { dirname, join, basename } from 'path';
import { command, flag, arg, summary, rest } from 'paparam'

const compare = command(
  'compare',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then cwd is used'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('<repo>', 'repo url'),
  arg('<older>', 'the older tag, commit, or branch'),
  arg('[newer]', 'the newer tag, commit, or branch'),
  () => {
    console.log('compare', compare.args, compare.flags)
  }
)
const release = command(
  'release',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then cwd is used'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('<repo>', 'repo url'),
  arg('[tag]', 'tag or branch'),
  () => {
    console.log('release', release.args, release.flags)
  }

)
const cmd = command('dependency-change-report', summary('show dependency changes between versions'), compare, release )
const init = async () => {
  cmd.parse()
}

/**
 * CLI interface for dependency change analysis
 * @returns {Promise<void>}
 */
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
      console.error('Usage: dependency-change-report <github-repo> <older-version> <newer-version> [working-dir] [namespace]');
      console.error('  <older-version> and <newer-version> can be any git reference (tag, branch, commit)');
      console.error('  [namespace] is optional - if provided, only second-level dependencies within this namespace will be analyzed (e.g., @holepunch)');
      console.error('');
      console.error('This command generates four files:');
      console.error('  - report.json (raw data)');
      console.error('  - report.html (web-friendly report)');
      console.error('  - report.md (markdown report)');
      console.error('  - report.txt (Slack-friendly text report)');
      process.exit(1);
    }
    
    const [repoUrl, olderVersion, newerVersion, workingDir, namespace] = args;
    
    console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);
    if (namespace) {
      console.log(`Filtering second-level dependencies to only include those in namespace: ${namespace}`);
    }
    const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir, namespace);
    
    console.log('\nSummary:');
    console.log(`Added dependencies: ${report.changes.added.length}`);
    console.log(`Upgraded dependencies: ${report.changes.upgraded.length}`);
    console.log(`Removed dependencies: ${report.changes.removed.length}`);
    console.log(`Modified dependencies (namespace changes): ${report.changes.modified ? report.changes.modified.length : 0}`);
    
    // Display nested dependency information if available
    if (report.changes.nested) {
      console.log('\nNested Dependencies:');
      console.log(`Added nested dependencies: ${report.changes.nested.added.length}`);
      console.log(`Upgraded nested dependencies: ${report.changes.nested.upgraded.length}`);
      console.log(`Removed nested dependencies: ${report.changes.nested.removed.length}`);
      
      if (namespace) {
        console.log(`\nNote: Nested dependencies filtered by namespace: ${namespace}`);
      }
    }
    
    const changelogCount = Object.keys(report.changelogs).length;
    const errorCount = Object.keys(report.errors).length;
    console.log(`Generated changelogs for ${changelogCount} upgraded dependencies`);
    console.log(`Encountered errors with ${errorCount} dependencies`);
    
    // Generate HTML, Markdown, and text reports
    console.log('\nGenerating additional report formats...');
    
    // Use the actual report directory path from the report
    const reportJsonPath = report.reportPath;
    const reportDir = dirname(reportJsonPath);
    
    // Generate HTML report
    const htmlPath = join(reportDir, 'report.html');
    await generateHtmlReport(reportJsonPath, htmlPath);
    
    // Generate Markdown report
    const markdownPath = join(reportDir, 'report.md');
    await generateMarkdownReport(reportJsonPath, markdownPath);
    
    // Generate text report
    const textPath = join(reportDir, 'report.txt');
    await generateTextReport(reportJsonPath, textPath);
    
    console.log('\nAll reports generated successfully!');
    console.log(`📄 JSON: ${reportJsonPath}`);
    console.log(`🌐 HTML: ${htmlPath}`);
    console.log(`📝 Markdown: ${markdownPath}`);
    console.log(`📝 Text: ${textPath}`);
    
    // Display repository information for added dependencies
    if (report.changes.added.length > 0) {
      console.log('\nAdded dependencies with repositories:');
      report.changes.added.forEach(dep => {
        if (dep.repository) {
          console.log(`- ${dep.name}: ${dep.repository}`);
        }
      });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
init();
