#!/usr/bin/env node

import { compareReports } from './lib/compare-reports.mjs';
import { generateCompareMarkdown } from './lib/generate-compare-markdown.mjs';
import { dirname, join, resolve } from 'path';
import { writeFile, mkdir, access } from 'fs/promises';
import { command, flag, arg, summary } from 'paparam';

const compare = command(
  'dependency-change-compare',
  summary('compare dependency changes between two project reports'),
  flag('--output-dir [path]', 'directory to save reports. If not provided, reports are saved next to project1.json'),
  flag('--filter [patterns]', 'comma-separated glob patterns of module names to exclude (e.g. "react-native*,@expo/*")'),
  flag('--only [patterns]', 'comma-separated glob patterns of module names to include (inverse of --filter)'),
  flag('--ignore-dev', 'exclude devDependencies from comparison'),
  flag('--include-nested', 'include nested/transitive dependencies in comparison'),
  flag('--html', 'generate an HTML report'),
  flag('--markdown', 'generate a Markdown report'),
  flag('--text', 'generate a plain text report'),
  arg('<project1>', 'path to first project report.json'),
  arg('<project2>', 'path to second project report.json'),
  async () => {
    try {
      const project1Path = resolve(compare.args.project1);
      const project2Path = resolve(compare.args.project2);

      // Validate input files exist
      try {
        await access(project1Path);
      } catch {
        console.error(`Error: File not found: ${project1Path}`);
        process.exit(1);
      }
      try {
        await access(project2Path);
      } catch {
        console.error(`Error: File not found: ${project2Path}`);
        process.exit(1);
      }

      // Determine output directory
      let outputDir = compare.flags.outputDir;
      if (!outputDir) {
        outputDir = dirname(project1Path);
      }
      outputDir = resolve(outputDir);

      // Ensure output directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create output directory ${outputDir}: ${error.message}`);
        throw error;
      }

      // Parse filter/only patterns
      const excludePatterns = compare.flags.filter
        ? compare.flags.filter.split(',').map(p => p.trim()).filter(Boolean)
        : [];
      const includePatterns = compare.flags.only
        ? compare.flags.only.split(',').map(p => p.trim()).filter(Boolean)
        : [];

      const options = {
        excludePatterns,
        includePatterns,
        ignoreDev: compare.flags.ignoreDev || false,
        includeNested: compare.flags.includeNested || false
      };

      console.log(`Comparing dependency changes...`);
      console.log(`  Project 1: ${project1Path}`);
      console.log(`  Project 2: ${project2Path}`);
      if (excludePatterns.length > 0) {
        console.log(`  Excluding: ${excludePatterns.join(', ')}`);
      }
      if (includePatterns.length > 0) {
        console.log(`  Including only: ${includePatterns.join(', ')}`);
      }
      if (options.ignoreDev) {
        console.log(`  Ignoring devDependencies`);
      }
      if (options.includeNested) {
        console.log(`  Including nested dependencies`);
      }

      // Run comparison
      const result = await compareReports(project1Path, project2Path, options);

      // Write JSON report (always)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseFilename = `compare-report-${timestamp}`;
      const jsonPath = join(outputDir, `${baseFilename}.json`);
      await writeFile(jsonPath, JSON.stringify(result, null, 2));

      // Print installed data warning
      if (!result.hasInstalledData) {
        console.log('\nNote: Reports lack "installed" data. Noise reduction disabled.');
        console.log('Re-run dependency-change-report on each project to populate installed package snapshots.');
      }

      // Print summary
      console.log('\nComparison Summary:');
      console.log(`  Total discrepancies:       ${result.summary.totalDiscrepancies}`);
      console.log(`  Matching changes:          ${result.summary.totalMatching}`);
      if (result.summary.totalFrameworkSpecific > 0) {
        console.log(`  Framework-specific:        ${result.summary.totalFrameworkSpecific} (unique to one project)`);
      }
      if (result.summary.addedOnlyInProject1 > 0) {
        console.log(`  Added only in project 1:   ${result.summary.addedOnlyInProject1}`);
      }
      if (result.summary.addedOnlyInProject2 > 0) {
        console.log(`  Added only in project 2:   ${result.summary.addedOnlyInProject2}`);
      }
      if (result.summary.removedOnlyInProject1 > 0) {
        console.log(`  Removed only in project 1: ${result.summary.removedOnlyInProject1}`);
      }
      if (result.summary.removedOnlyInProject2 > 0) {
        console.log(`  Removed only in project 2: ${result.summary.removedOnlyInProject2}`);
      }
      if (result.summary.versionMismatch > 0) {
        console.log(`  Version mismatches:        ${result.summary.versionMismatch}`);
      }
      if (result.summary.upgradeOnlyInProject1 > 0) {
        console.log(`  Upgraded only in project 1: ${result.summary.upgradeOnlyInProject1}`);
      }
      if (result.summary.upgradeOnlyInProject2 > 0) {
        console.log(`  Upgraded only in project 2: ${result.summary.upgradeOnlyInProject2}`);
      }
      if (result.filtered.length > 0) {
        console.log(`  Filtered out:              ${result.filtered.length} packages`);
      }

      console.log(`\nJSON: ${jsonPath}`);

      // Generate additional formats
      const wantsSpecificFormat = compare.flags.html || compare.flags.markdown || compare.flags.text;

      if (!wantsSpecificFormat || compare.flags.markdown) {
        const mdPath = join(outputDir, `${baseFilename}.md`);
        await generateCompareMarkdown(result, mdPath);
        console.log(`Markdown: ${mdPath}`);
      }

      if (compare.flags.html) {
        // Placeholder for future HTML generation
        console.log('HTML report generation not yet implemented.');
      }

      if (compare.flags.text) {
        // Placeholder for future text generation
        console.log('Text report generation not yet implemented.');
      }

      console.log('\nComparison complete!');

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
);

const init = async () => {
  if (process.argv.length === 2) {
    console.log('Dependency Change Compare\n');
    console.log('Compare dependency changes between two project reports to find discrepancies.\n');
    console.log('Usage:');
    console.log('  dependency-change-compare <project1.json> <project2.json> [options]\n');
    console.log('Options:');
    console.log('  --filter <patterns>   Comma-separated glob patterns to exclude (e.g. "react-native*,@expo/*")');
    console.log('  --only <patterns>     Comma-separated glob patterns to include');
    console.log('  --ignore-dev          Exclude devDependencies from comparison');
    console.log('  --include-nested      Include nested/transitive dependencies');
    console.log('  --output-dir <path>   Directory to save reports');
    console.log('  --markdown            Generate Markdown report');
    console.log('  --html                Generate HTML report');
    console.log('  --text                Generate plain text report\n');
    console.log('If no format flags are passed, JSON and Markdown are generated by default.');
  } else {
    compare.parse();
  }
};

init();
