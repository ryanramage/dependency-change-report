#!/usr/bin/env node

import { analyzeDependencyChanges } from './index.mjs';

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
      console.error('Usage: node cli.mjs <github-repo> <older-version> <newer-version> [working-dir] [namespace]');
      console.error('  <older-version> and <newer-version> can be any git reference (tag, branch, commit)');
      console.error('  [namespace] is optional - if provided, only second-level dependencies within this namespace will be analyzed (e.g., @holepunch)');
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
main();
