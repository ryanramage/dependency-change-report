#!/usr/bin/env node

import { analyzeDependencyChanges } from './lib/index.mjs';
import { generateHtmlReport } from './lib/generate-html.mjs';
import { generateTextReport } from './lib/generate-text.mjs';
import { generateMarkdownReport } from './lib/generate-markdown.mjs';
import { detectVersions } from './lib/utils/version-detector.mjs';
import { dirname, join, basename } from 'path';
import { command, flag, arg, summary, rest } from 'paparam'
import envPaths from 'env-paths';
import { executeCommand } from './lib/utils/command-executor.mjs';
import { mkdir } from 'fs/promises';

const compare = command(
  'compare',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then temp dir is used'),
  flag('--output-dir [path]', 'directory to save reports. If not provided, reports are saved in working dir'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('<repo>', 'repo url'),
  arg('<older>', 'the older tag, commit, or branch'),
  arg('[newer]', 'the newer tag, commit, or branch'),
  async () => {
    try {
      let repoUrl = compare.args.repo;
      const olderVersion = compare.args.older;
      const newerVersion = compare.args.newer;
      
      // Use temp directory if working-dir not specified
      let workingDir = compare.flags['working-dir'];
      if (!workingDir) {
        const paths = envPaths('dependency-change-report');
        workingDir = paths.temp;
      }
      
      // Detect if running in GitHub Actions
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      
      // Note: No need for GitHub token authentication when using worktrees
      // since we use the already-authenticated repository
      if (isGitHubActions) {
        console.log('GitHub Actions detected - using authenticated repository');
      }
      
      // Set up output directory
      let outputDir = compare.flags['output-dir'];
      if (!outputDir) {
        outputDir = workingDir; // Default to working directory
      }
      
      // Ensure output directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create output directory ${outputDir}: ${error.message}`);
        throw error;
      }
      
      console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);
      
      const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir, null, compare.flags.ignoreDev);
      
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
      
      // Generate additional report formats
      console.log('\nGenerating additional report formats...');
      
      const reportJsonPath = report.reportPath;
      
      // Generate GitHub Actions-friendly filenames if detected
      let baseFilename = 'report';
      if (isGitHubActions) {
        const eventName = process.env.GITHUB_EVENT_NAME;
        let prNumber = process.env.GITHUB_PR_NUMBER;
        const sha = process.env.GITHUB_SHA?.substring(0, 7);
        
        // Extract PR number from GITHUB_REF_NAME if not in GITHUB_PR_NUMBER
        if (!prNumber && process.env.GITHUB_REF_NAME) {
          const refName = process.env.GITHUB_REF_NAME;
          const prMatch = refName.match(/^(\d+)\/merge$/);
          if (prMatch) {
            prNumber = prMatch[1];
          }
        }
        
        if (eventName === 'pull_request' && prNumber) {
          baseFilename = `dependency-report-PR-${prNumber}`;
        } else if (sha) {
          baseFilename = `dependency-report-${sha}`;
        }
      }
      
      if (compare.flags.html || compare.flags.markdown || compare.flags.text) {
        if (compare.flags.html) {
          const htmlPath = join(outputDir, `${baseFilename}.html`);
          await generateHtmlReport(reportJsonPath, htmlPath);
          console.log(`🌐 HTML: ${htmlPath}`);
        }
        
        if (compare.flags.markdown) {
          const markdownPath = join(outputDir, `${baseFilename}.md`);
          await generateMarkdownReport(reportJsonPath, markdownPath);
          console.log(`📝 Markdown: ${markdownPath}`);
        }
        
        if (compare.flags.text) {
          const textPath = join(outputDir, `${baseFilename}.txt`);
          await generateTextReport(reportJsonPath, textPath);
          console.log(`📝 Text: ${textPath}`);
        }
      } else {
        // Generate HTML, Markdown, and text reports by default
        const htmlPath = join(outputDir, `${baseFilename}.html`);
        const markdownPath = join(outputDir, `${baseFilename}.md`);
        const textPath = join(outputDir, `${baseFilename}.txt`);
        
        await generateHtmlReport(reportJsonPath, htmlPath);
        await generateMarkdownReport(reportJsonPath, markdownPath);
        await generateTextReport(reportJsonPath, textPath);
        
        console.log(`🌐 HTML: ${htmlPath}`);
        console.log(`📝 Markdown: ${markdownPath}`);
        console.log(`📝 Text: ${textPath}`);
      }
      
      // Output GitHub Actions commands if detected
      if (isGitHubActions) {
        const hasChanges = report.changes.added.length > 0 || report.changes.upgraded.length > 0 || report.changes.removed.length > 0;
        console.log(`::set-output name=has-changes::${hasChanges}`);
        console.log(`::set-output name=added-count::${report.changes.added.length}`);
        console.log(`::set-output name=upgraded-count::${report.changes.upgraded.length}`);
        console.log(`::set-output name=removed-count::${report.changes.removed.length}`);
        console.log(`::set-output name=report-dir::${outputDir}`);
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
  flag('--output-dir [path]', 'directory to save reports. If not provided, reports are saved in working dir'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  arg('[repo]', 'repo url (optional if in git directory)'),
  async () => {
    try {
      let repoUrl = auto.args.repo;
      
      // If no repo provided, try to get it from git remote
      if (!repoUrl) {
        try {
          const result = await executeCommand('git', ['remote', 'get-url', 'origin'], process.cwd(), 10000, 'detecting git remote');
          if (!result) {
            throw new Error('Git command returned no output');
          }
          repoUrl = result.trim()
          if (!repoUrl) {
            throw new Error('Git remote URL is empty');
          }
          console.log(`Detected git remote: ${repoUrl}`);
        } catch (error) {
          console.error(`Failed to detect git remote: ${error.message}`);
          throw new Error('No repo URL provided and could not detect git remote. Either provide a repo URL or run from within a git repository.');
        }
      }
      
      // Use temp directory if working-dir not specified
      let workingDir = auto.flags['working-dir'];
      if (!workingDir) {
        const paths = envPaths('dependency-change-report');
        workingDir = paths.temp;
      }
      
      // Detect if running in GitHub Actions
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      
      // Note: No need for GitHub token authentication when using worktrees
      // since we use the already-authenticated repository
      if (isGitHubActions) {
        console.log('GitHub Actions detected - using authenticated repository');
      }
      
      // Set up output directory
      let outputDir = auto.flags['output-dir'];
      if (!outputDir) {
        outputDir = workingDir; // Default to working directory
      }
      
      // Ensure output directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create output directory ${outputDir}: ${error.message}`);
        throw error;
      }
      
      console.log(`Auto-detecting versions for ${repoUrl}...`);
      
      // Detect versions automatically
      const { newer, older } = await detectVersions('.');
      
      console.log(`Analyzing dependency changes between ${older} and ${newer}`);
      
      const report = await analyzeDependencyChanges(repoUrl, older, newer, workingDir, null, auto.flags.ignoreDev);
      
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
      
      // Generate additional report formats
      console.log('\nGenerating additional report formats...');
      
      const reportJsonPath = report.reportPath;
      
      // Generate GitHub Actions-friendly filenames if detected
      let baseFilename = 'report';
      if (isGitHubActions) {
        const eventName = process.env.GITHUB_EVENT_NAME;
        let prNumber = process.env.GITHUB_PR_NUMBER;
        const sha = process.env.GITHUB_SHA?.substring(0, 7);
        
        // Extract PR number from GITHUB_REF_NAME if not in GITHUB_PR_NUMBER
        if (!prNumber && process.env.GITHUB_REF_NAME) {
          const refName = process.env.GITHUB_REF_NAME;
          const prMatch = refName.match(/^(\d+)\/merge$/);
          if (prMatch) {
            prNumber = prMatch[1];
          }
        }
        
        if (eventName === 'pull_request' && prNumber) {
          baseFilename = `dependency-report-PR-${prNumber}`;
        } else if (sha) {
          baseFilename = `dependency-report-${sha}`;
        }
      }
      
      if (auto.flags.html || auto.flags.markdown || auto.flags.text) {
        if (auto.flags.html) {
          const htmlPath = join(outputDir, `${baseFilename}.html`);
          await generateHtmlReport(reportJsonPath, htmlPath);
          console.log(`🌐 HTML: ${htmlPath}`);
        }
        
        if (auto.flags.markdown) {
          const markdownPath = join(outputDir, `${baseFilename}.md`);
          await generateMarkdownReport(reportJsonPath, markdownPath);
          console.log(`📝 Markdown: ${markdownPath}`);
        }
        
        if (auto.flags.text) {
          const textPath = join(outputDir, `${baseFilename}.txt`);
          await generateTextReport(reportJsonPath, textPath);
          console.log(`📝 Text: ${textPath}`);
        }
      } else {
        // Generate HTML, Markdown, and text reports by default
        const htmlPath = join(outputDir, `${baseFilename}.html`);
        const markdownPath = join(outputDir, `${baseFilename}.md`);
        const textPath = join(outputDir, `${baseFilename}.txt`);
        
        await generateHtmlReport(reportJsonPath, htmlPath);
        await generateMarkdownReport(reportJsonPath, markdownPath);
        await generateTextReport(reportJsonPath, textPath);
        
        console.log(`🌐 HTML: ${htmlPath}`);
        console.log(`📝 Markdown: ${markdownPath}`);
        console.log(`📝 Text: ${textPath}`);
      }
      
      // Output GitHub Actions commands if detected
      if (isGitHubActions) {
        const hasChanges = report.changes.added.length > 0 || report.changes.upgraded.length > 0 || report.changes.removed.length > 0;
        console.log(`::set-output name=has-changes::${hasChanges}`);
        console.log(`::set-output name=added-count::${report.changes.added.length}`);
        console.log(`::set-output name=upgraded-count::${report.changes.upgraded.length}`);
        console.log(`::set-output name=removed-count::${report.changes.removed.length}`);
        console.log(`::set-output name=report-dir::${outputDir}`);
      }
      
      console.log('\nReport generated successfully!');
      console.log(`📄 JSON: ${report.reportPath}`);
      
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
)
const cmd = command('dependency-change-report', summary('show dependency changes between versions'), compare, auto )
const init = async () => {
  cmd.parse()
}

// Run the main function
init();
