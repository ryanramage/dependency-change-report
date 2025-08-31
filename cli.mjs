#!/usr/bin/env node

import { analyzeDependencyChanges } from './lib/index.mjs';
import { generateHtmlReport } from './lib/generate-html.mjs';
import { generateTextReport } from './lib/generate-text.mjs';
import { generateMarkdownReport } from './lib/generate-markdown.mjs';
import { detectVersions } from './lib/utils/version-detector.mjs';
import { dirname, join, basename } from 'path';
import { command, flag, arg, summary, rest } from 'paparam'
import envPaths from 'env-paths';

const compare = command(
  'compare',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then temp dir is used'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('<repo>', 'repo url'),
  arg('<older>', 'the older tag, commit, or branch'),
  arg('[newer]', 'the newer tag, commit, or branch'),
  async () => {
    try {
      const repoUrl = compare.args.repo;
      const olderVersion = compare.args.older;
      const newerVersion = compare.args.newer;
      
      // Use temp directory if working-dir not specified
      let workingDir = compare.flags['working-dir'];
      if (!workingDir) {
        const paths = envPaths('dependency-change-report');
        workingDir = paths.temp;
      }
      
      console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);
      
      const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir);
      
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
      }
      
      const changelogCount = Object.keys(report.changelogs).length;
      const errorCount = Object.keys(report.errors).length;
      console.log(`Generated changelogs for ${changelogCount} upgraded dependencies`);
      console.log(`Encountered errors with ${errorCount} dependencies`);
      
      // Generate additional report formats if requested
      if (compare.flags.html || compare.flags.markdown || compare.flags.text) {
        console.log('\nGenerating additional report formats...');
        
        const reportJsonPath = report.reportPath;
        const reportDir = dirname(reportJsonPath);
        
        if (compare.flags.html) {
          const htmlPath = join(reportDir, 'report.html');
          await generateHtmlReport(reportJsonPath, htmlPath);
          console.log(`🌐 HTML: ${htmlPath}`);
        }
        
        if (compare.flags.markdown) {
          const markdownPath = join(reportDir, 'report.md');
          await generateMarkdownReport(reportJsonPath, markdownPath);
          console.log(`📝 Markdown: ${markdownPath}`);
        }
        
        if (compare.flags.text) {
          const textPath = join(reportDir, 'report.txt');
          await generateTextReport(reportJsonPath, textPath);
          console.log(`📝 Text: ${textPath}`);
        }
      } else {
        // Generate HTML, Markdown, and text reports by default
        console.log('\nGenerating additional report formats...');
        
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
        
        console.log(`🌐 HTML: ${htmlPath}`);
        console.log(`📝 Markdown: ${markdownPath}`);
        console.log(`📝 Text: ${textPath}`);
      }
      
      console.log('\nReport generated successfully!');
      console.log(`📄 JSON: ${report.reportPath}`);
      
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
  }
)

const auto = command(
  'auto',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then temp dir is used'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('<repo>', 'repo url'),
  async () => {
    try {
      const repoUrl = auto.args.repo;
      // Use temp directory if working-dir not specified
      let workingDir = auto.flags['working-dir'];
      if (!workingDir) {
        const paths = envPaths('dependency-change-report');
        workingDir = paths.temp;
      }
      
      console.log(`Auto-detecting versions for ${repoUrl}...`);
      
      // Detect versions automatically
      const { newer, older } = await detectVersions('.');
      
      console.log(`Analyzing dependency changes between ${older} and ${newer}`);
      
      const report = await analyzeDependencyChanges(repoUrl, older, newer, workingDir);
      
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
      }
      
      const changelogCount = Object.keys(report.changelogs).length;
      const errorCount = Object.keys(report.errors).length;
      console.log(`Generated changelogs for ${changelogCount} upgraded dependencies`);
      console.log(`Encountered errors with ${errorCount} dependencies`);
      
      // Generate additional report formats if requested
      if (auto.flags.html || auto.flags.markdown || auto.flags.text) {
        console.log('\nGenerating additional report formats...');
        
        const reportJsonPath = report.reportPath;
        const reportDir = dirname(reportJsonPath);
        
        if (auto.flags.html) {
          const htmlPath = join(reportDir, 'report.html');
          await generateHtmlReport(reportJsonPath, htmlPath);
          console.log(`🌐 HTML: ${htmlPath}`);
        }
        
        if (auto.flags.markdown) {
          const markdownPath = join(reportDir, 'report.md');
          await generateMarkdownReport(reportJsonPath, markdownPath);
          console.log(`📝 Markdown: ${markdownPath}`);
        }
        
        if (auto.flags.text) {
          const textPath = join(reportDir, 'report.txt');
          await generateTextReport(reportJsonPath, textPath);
          console.log(`📝 Text: ${textPath}`);
        }
      } else {
        // Generate HTML, Markdown, and text reports by default
        console.log('\nGenerating additional report formats...');
        
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
        
        console.log(`🌐 HTML: ${htmlPath}`);
        console.log(`📝 Markdown: ${markdownPath}`);
        console.log(`📝 Text: ${textPath}`);
      }
      
      console.log('\nReport generated successfully!');
      console.log(`📄 JSON: ${report.reportPath}`);
      
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
)
const cmd = command('dependency-change-report', summary('show dependency changes between versions'), compare, release, auto )
const init = async () => {
  cmd.parse()
}

// Run the main function
init();
