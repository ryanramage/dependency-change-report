#!/usr/bin/env node

import { analyzeDependencyChanges } from './index.mjs';

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
      console.error('Usage: node cli.mjs <github-repo> <older-version> <newer-version> [working-dir]');
      console.error('  <older-version> and <newer-version> can be any git reference (tag, branch, commit)');
      process.exit(1);
    }
    
    const [repoUrl, olderVersion, newerVersion, workingDir] = args;
    
    console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);
    const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir);
    
    console.log('\nSummary:');
    console.log(`Added dependencies: ${report.changes.added.length}`);
    console.log(`Upgraded dependencies: ${report.changes.upgraded.length}`);
    console.log(`Removed dependencies: ${report.changes.removed.length}`);
    console.log(`Modified dependencies (namespace changes): ${report.changes.modified ? report.changes.modified.length : 0}`);
    
    const changelogCount = Object.keys(report.changelogs).length;
    const errorCount = Object.keys(report.errors).length;
    console.log(`Generated changelogs for ${changelogCount} upgraded dependencies`);
    console.log(`Encountered errors with ${errorCount} dependencies`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
main();
