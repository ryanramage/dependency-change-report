#!/usr/bin/env node

import { analyzeDependencyChanges } from './lib/index.mjs';
import { generateHtmlReport } from './lib/generate-html.mjs';
import { generateTextReport } from './lib/generate-text.mjs';
import { generateMarkdownReport } from './lib/generate-markdown.mjs';
import { detectVersions, detectCurrentRef } from './lib/utils/version-detector.mjs';
import { resolveBaseline, readDcrConfig, resolveIgnoreDev, resolveSkipFullInventory, resolveOutput, splitIgnoreEntries, readProjects, readCompareOptions } from './lib/utils/config.mjs';
import { cloneRepo } from './lib/git/repository.mjs';
import { compareReports } from './lib/compare-reports.mjs';
import { generateCompareMarkdown } from './lib/generate-compare-markdown.mjs';
import { dirname, join, basename, resolve, relative } from 'path';
import { command, flag, arg, summary, rest } from 'paparam'
import envPaths from 'env-paths';
import PQueue from 'p-queue';
import { existsSync } from 'fs';
import { executeCommand } from './lib/utils/command-executor.mjs';
import { mkdir, appendFile, writeFile, copyFile, rm } from 'fs/promises';

/**
 * Emit a GitHub Actions step output. Uses the modern $GITHUB_OUTPUT file when
 * available, falling back to the legacy ::set-output command otherwise.
 */
const setActionOutput = async (name, value) => {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    await appendFile(outputFile, `${name}=${value}\n`);
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
};

/**
 * Emit the standard set of report outputs from a generated report.
 */
const emitReportOutputs = async (report, outputDir) => {
  const hasChanges = report.changes.added.length > 0 || report.changes.upgraded.length > 0 || report.changes.removed.length > 0;
  await setActionOutput('has-changes', hasChanges);
  await setActionOutput('added-count', report.changes.added.length);
  await setActionOutput('upgraded-count', report.changes.upgraded.length);
  await setActionOutput('removed-count', report.changes.removed.length);
  await setActionOutput('report-dir', outputDir);
  await setActionOutput('report-json-path', report.reportPath);
  await setActionOutput('older-version', report.olderVersion);
  await setActionOutput('newer-version', report.newerVersion);
};

/**
 * Generate the requested report formats from a report.json.
 * @param {string[]} formats - subset of 'html' | 'markdown' | 'text'
 */
const generateFormats = async (reportJsonPath, outputDir, baseFilename, formats) => {
  for (const fmt of formats) {
    if (fmt === 'html') {
      const htmlPath = join(outputDir, `${baseFilename}.html`);
      await generateHtmlReport(reportJsonPath, htmlPath);
      console.log(`🌐 HTML: ${htmlPath}`);
    } else if (fmt === 'markdown') {
      const markdownPath = join(outputDir, `${baseFilename}.md`);
      await generateMarkdownReport(reportJsonPath, markdownPath);
      console.log(`📝 Markdown: ${markdownPath}`);
    } else if (fmt === 'text') {
      const textPath = join(outputDir, `${baseFilename}.txt`);
      await generateTextReport(reportJsonPath, textPath);
      console.log(`📝 Text: ${textPath}`);
    }
  }
};

const compare = command(
  'compare',
  flag('--ignore-dev', 'ignore dev dependencies'),
  flag('--debug-tree', 'output debug information about dependency tree filtering'),
  flag('--cleanup-worktrees', 'clean up stale git worktrees before starting'),
  flag('--skip-full-inventory', 'skip generating complete dependency inventory table (enabled by default)'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then temp dir is used'),
  flag('--output-dir [path]', 'directory to save reports. If not provided, reports are saved in working dir'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  flag('--repo [url]', 'repo url (optional if in git directory)'),
  flag('--config-file [path]', 'path to .dcr.json config (default: .dcr.json)'),
  arg('<older>', 'the older tag, commit, or branch'),
  arg('<newer>', 'the newer tag, commit, or branch'),
  async () => {
    try {
      let repoUrl = compare.flags.repo;

      // If no repo provided, try to get it from git remote
      if (!repoUrl) {
        try {
          const result = await executeCommand('git', ['remote', 'get-url', 'origin'], process.cwd(), 10000, 'detecting git remote');
          if (!result) {
            throw new Error('Git command returned no output');
          }
          repoUrl = result.trim();
          if (!repoUrl) {
            throw new Error('Git remote URL is empty');
          }
          console.log(`Detected git remote: ${repoUrl}`);
        } catch (error) {
          console.error(`Failed to detect git remote: ${error.message}`);
          throw new Error('No repo URL provided and could not detect git remote. Either provide a repo URL or run from within a git repository.');
        }
      }

      const olderVersion = compare.args.older;
      const newerVersion = compare.args.newer;

      // Use temp directory if working-dir not specified
      let workingDir = compare.flags.workingDir;
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

      // Load .dcr.json config; flags take precedence, config fills gaps.
      const config = await readDcrConfig('.', compare.flags.configFile || '.dcr.json');
      const ignoreDev = resolveIgnoreDev(compare.flags.ignoreDev, config);
      const generateFullInventory = !resolveSkipFullInventory(compare.flags.skipFullInventory, config);
      const extraIgnore = splitIgnoreEntries(Array.isArray(config.ignore) ? config.ignore : []);
      const resolvedOutput = resolveOutput(compare.flags.outputDir, { html: compare.flags.html, markdown: compare.flags.markdown, text: compare.flags.text }, config);

      // Set up output directory (flag > config > working dir)
      const outputDir = resolvedOutput.dir || workingDir;

      // Ensure output directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create output directory ${outputDir}: ${error.message}`);
        throw error;
      }

      console.log(`Analyzing dependency changes for ${repoUrl} between older version (${olderVersion}) and newer version (${newerVersion})`);

      const report = await analyzeDependencyChanges(repoUrl, olderVersion, newerVersion, workingDir, null, ignoreDev, compare.flags.debugTree, compare.flags.cleanupWorktrees, generateFullInventory, { repoDir: process.cwd(), extraIgnore });

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
      } else {
        // For local/CLI usage, use version-based filename
        // Sanitize versions to be filesystem-safe (remove invalid characters)
        const sanitizeVersion = (v) => v.replace(/[\/\\:*?"<>|]/g, '-');
        const olderSafe = sanitizeVersion(report.olderVersion);
        const newerSafe = sanitizeVersion(report.newerVersion);
        baseFilename = `${olderSafe}→${newerSafe}`;
      }

      // Formats: CLI flags > config output.formats > all three (default)
      const formats = resolvedOutput.formats || ['html', 'markdown', 'text'];
      await generateFormats(reportJsonPath, outputDir, baseFilename, formats);

      // Output GitHub Actions commands if detected
      if (isGitHubActions) {
        await emitReportOutputs(report, outputDir);
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
  flag('--debug-tree', 'output debug information about dependency tree filtering'),
  flag('--cleanup-worktrees', 'clean up stale git worktrees before starting'),
  flag('--skip-full-inventory', 'skip generating complete dependency inventory table (enabled by default)'),
  flag('--working-dir [path]', 'the working dir for the report. If not provided, then temp dir is used'),
  flag('--output-dir [path]', 'directory to save reports. If not provided, reports are saved in working dir'),
  flag('--html', 'generate a html report'),
  flag('--markdown', 'generate a markdown report'),
  flag('--text', 'generate a text only report'),
  flag('--base-ref [ref]', 'explicit baseline ("older") ref; overrides auto-detection and .dcr.json'),
  flag('--config-file [path]', 'path to config file holding a pinned baseline (default: .dcr.json)'),
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
      let workingDir = auto.flags.workingDir;
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

      // Load .dcr.json config; flags take precedence, config fills gaps.
      const config = await readDcrConfig('.', auto.flags.configFile || '.dcr.json');
      const ignoreDev = resolveIgnoreDev(auto.flags.ignoreDev, config);
      const generateFullInventory = !resolveSkipFullInventory(auto.flags.skipFullInventory, config);
      const extraIgnore = splitIgnoreEntries(Array.isArray(config.ignore) ? config.ignore : []);
      const resolvedOutput = resolveOutput(auto.flags.outputDir, { html: auto.flags.html, markdown: auto.flags.markdown, text: auto.flags.text }, config);

      // Set up output directory (flag > config > working dir)
      const outputDir = resolvedOutput.dir || workingDir;

      // Ensure output directory exists
      try {
        await mkdir(outputDir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create output directory ${outputDir}: ${error.message}`);
        throw error;
      }

      // Resolve baseline: --base-ref flag > .dcr.json baseline > auto-detection
      const baseline = auto.flags.baseRef || config.baseline || null;

      let newer;
      let older;
      if (baseline) {
        // Pinned baseline (e.g. a release train): only detect the current ref,
        // skipping tag auto-detection so it never overrides the pin.
        newer = await detectCurrentRef('.');
        older = baseline;
        const source = auto.flags.baseRef ? '--base-ref' : '.dcr.json';
        console.log(`Using pinned baseline (${source}): ${older}`);
      } else {
        console.log(`Auto-detecting versions for ${repoUrl}...`);
        ({ newer, older } = await detectVersions('.'));
      }

      console.log(`Analyzing dependency changes between ${older} and ${newer}`);

      const report = await analyzeDependencyChanges(repoUrl, older, newer, workingDir, null, ignoreDev, auto.flags.debugTree, auto.flags.cleanupWorktrees, generateFullInventory, { repoDir: process.cwd(), extraIgnore });

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
      } else {
        // For local/CLI usage, use version-based filename
        // Sanitize versions to be filesystem-safe (remove invalid characters)
        const sanitizeVersion = (v) => v.replace(/[\/\\:*?"<>|]/g, '-');
        const olderSafe = sanitizeVersion(report.olderVersion);
        const newerSafe = sanitizeVersion(report.newerVersion);
        baseFilename = `${olderSafe}→${newerSafe}`;
      }

      // Formats: CLI flags > config output.formats > all three (default)
      const formats = resolvedOutput.formats || ['html', 'markdown', 'text'];
      await generateFormats(reportJsonPath, outputDir, baseFilename, formats);

      // Output GitHub Actions commands if detected
      if (isGitHubActions) {
        await emitReportOutputs(report, outputDir);
      }

      console.log('\nReport generated successfully!');
      console.log(`📄 JSON: ${report.reportPath}`);

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
)
const isGitCheckout = (dir) => existsSync(join(dir, '.git'));

/**
 * Resolve the git directory to analyze for a project: prefer an existing local
 * checkout (`project.path`); otherwise clone `project.repo` into the working
 * dir (full clone so both baseline + current refs are available). Reuses an
 * existing clone by fetching. Returns the dir, or null if neither is usable.
 */
const resolveProjectDir = async (project, workingDir) => {
  if (project.path) {
    const resolved = resolve(project.path);
    if (isGitCheckout(resolved)) {
      console.log(`Using local checkout: ${resolved}`);
      return resolved;
    }
    console.warn(`Configured path is not a git checkout: ${resolved}`);
  }
  if (project.repo) {
    const dest = join(workingDir, 'checkouts', project.name);
    if (isGitCheckout(dest)) {
      console.log(`Reusing clone at ${dest} (fetching latest)...`);
      try {
        await executeCommand('git', ['fetch', '--all', '--tags', '--prune'], dest, 600000, `git fetch ${project.name}`, false);
      } catch (error) {
        console.warn(`Fetch failed for ${project.name}: ${error.message}`);
      }
      if (project.ref) {
        try {
          // A previous run's checkout left a local branch named after the ref;
          // a plain `git checkout <ref>` would reuse it as-is even though the
          // fetch above moved origin/<ref> forward, so the analysis would run
          // against a stale commit. When the ref is a remote branch, force the
          // local branch to the remote tip; tags/SHAs get a plain checkout.
          let isRemoteBranch = false;
          try {
            await executeCommand('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${project.ref}`], dest, 60000, `check origin/${project.ref}`, false);
            isRemoteBranch = true;
          } catch (error) {
            // Not a remote branch — fall through to a plain checkout.
          }
          if (isRemoteBranch) {
            await executeCommand('git', ['checkout', '-B', project.ref, `origin/${project.ref}`], dest, 60000, `git checkout -B ${project.ref} origin/${project.ref}`, false);
          } else {
            await executeCommand('git', ['checkout', project.ref], dest, 60000, `git checkout ${project.ref}`, false);
          }
        } catch (error) {
          console.warn(`Checkout of ${project.ref} failed for ${project.name}: ${error.message}`);
        }
      }
      return dest;
    }
    console.log(`Cloning ${project.repo} into ${dest}...`);
    await cloneRepo(project.repo, project.ref || null, dest, false, { shallow: false });
    return dest;
  }
  return null;
};

/**
 * Generate a dependency report for one project, reading its own .dcr.json.
 * Returns { name, path } or null on failure so one bad project doesn't abort
 * the whole run. `parallelism` (>1 when running projects concurrently)
 * suppresses the interactive progress bar and caps changelog concurrency so
 * parallel analyses don't fight over the terminal or hit GitHub rate limits.
 */
/** Make a value safe to use as a single path segment (refs may contain slashes). */
const safeSeg = (v) => String(v).replace(/[\/\\:*?"<>|]/g, '-');

const generateProjectReport = async (project, workingDir, parallelism, outputDir, runTs) => {
  const label = `[${project.name}]`;
  try {
    const repoDir = await resolveProjectDir(project, workingDir);
    if (!repoDir) {
      console.warn(`${label} Skipping: no usable local path or repo URL.`);
      return null;
    }

    const pcfg = await readDcrConfig(repoDir);
    const newer = project.ref || await detectCurrentRef(repoDir);
    let older = project.baseline || await resolveBaseline(undefined, repoDir);
    if (!older) {
      older = (await detectVersions(repoDir)).older;
    }
    // In projects mode, ignore devDependencies by default (less config); a repo
    // can opt back in with "ignoreDev": false in its own .dcr.json.
    const ignoreDev = resolveIgnoreDev(false, pcfg, true);
    const generateFullInventory = !resolveSkipFullInventory(false, pcfg);
    const extraIgnore = splitIgnoreEntries(Array.isArray(pcfg.ignore) ? pcfg.ignore : []);

    const quietProgress = parallelism > 1;
    const changelogConcurrency = parallelism > 1 ? Math.max(1, Math.floor(5 / parallelism)) : 5;

    console.log(`${label} Analyzing between ${older} and ${newer}...`);
    const report = await analyzeDependencyChanges(
      project.repo || project.name, older, newer, join(workingDir, project.name),
      null, ignoreDev, false, false, generateFullInventory,
      { repoDir, extraIgnore, quietProgress, changelogConcurrency, minimizeDisk: true }
    );

    // Publish layout: <outputDir>/<project>/<older>..<newer>__<ts>/report.{json,md}
    const dir = join(outputDir, safeSeg(project.name), `${safeSeg(older)}..${safeSeg(newer)}__${runTs}`);
    await mkdir(dir, { recursive: true });
    const jsonPath = join(dir, 'report.json');
    const mdPath = join(dir, 'report.md');
    await copyFile(report.reportPath, jsonPath);
    await generateMarkdownReport(jsonPath, mdPath);

    // Delete the heavy scratch dir (worktrees + node_modules) now that the
    // report is saved, so disk stays bounded across projects/runs.
    try {
      await rm(dirname(report.reportPath), { recursive: true, force: true });
    } catch (error) {
      console.warn(`${label} Could not clean scratch dir: ${error.message}`);
    }

    console.log(`${label} Report ready: ${jsonPath}`);
    return { name: project.name, older, newer, jsonPath, mdPath, dir };
  } catch (error) {
    console.error(`${label} Failed: ${error.message}`);
    return null;
  }
};

const projects = command(
  'projects',
  summary('generate reports for multiple repos (from .dcr.json) and compare them'),
  flag('--config-file [path]', 'path to the compare-repo .dcr.json (default: .dcr.json)'),
  flag('--working-dir [path]', 'working dir for checkouts/worktrees (default: temp dir)'),
  flag('--output-dir [path]', 'directory to save comparison reports (default: current dir)'),
  flag('--concurrency [n]', 'how many projects to analyze in parallel (default: up to 4; 1 = serial with progress bars)'),
  flag('--markdown', 'generate a Markdown report (default when no format flag given)'),
  flag('--html', 'generate an HTML report'),
  flag('--text', 'generate a text report'),
  async () => {
    try {
      const configFile = projects.flags.configFile || '.dcr.json';
      const projectList = await readProjects('.', configFile);
      if (projectList.length < 2) {
        throw new Error('The `projects` command needs at least 2 projects in .dcr.json (a "projects" array with name + path/repo).');
      }
      // Project names key the per-project checkout + scratch dirs, so they must
      // be unique (especially under parallelism, where collisions would clash).
      const names = projectList.map((p) => p.name);
      const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      if (dupes.length > 0) {
        throw new Error(`Duplicate project name(s) in .dcr.json: ${dupes.join(', ')}. Project names must be unique.`);
      }

      const compareOpts = await readCompareOptions('.', configFile);

      let workingDir = projects.flags.workingDir;
      if (!workingDir) {
        // Use the disk-backed cache dir, NOT the temp dir — temp is often a
        // small RAM tmpfs, and projects mode writes many GB of node_modules and
        // clones (per project, per version). Overridable with --working-dir.
        workingDir = envPaths('dependency-change-report').cache;
      }
      const outputDir = projects.flags.outputDir || process.cwd();
      await mkdir(outputDir, { recursive: true });

      // Resolve parallelism: flag > default (up to 4), clamped to [1, #projects].
      const requested = parseInt(projects.flags.concurrency, 10);
      const parallelism = Math.max(1, Math.min(
        Number.isNaN(requested) ? Math.min(projectList.length, 4) : requested,
        projectList.length
      ));

      // One timestamp for the whole run, so all of this run's project reports
      // and the comparison share it (and sort/correlate together).
      const runTs = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');

      // 1. Generate each project's report (reading its OWN .dcr.json), in
      // parallel up to `parallelism`. Promise.all over the mapped queue tasks
      // preserves input order, so generated[0] stays the first-listed project.
      console.log(`Generating ${projectList.length} reports (concurrency: ${parallelism})...`);
      const queue = new PQueue({ concurrency: parallelism });
      const results = await Promise.all(
        projectList.map((project) => queue.add(() => generateProjectReport(project, workingDir, parallelism, outputDir, runTs)))
      );
      const generated = results.filter(Boolean);

      if (generated.length < 2) {
        const okNames = new Set(generated.map((g) => g.name));
        const failed = projectList.map((p) => p.name).filter((n) => !okNames.has(n));
        throw new Error(
          `Fewer than 2 reports were generated; cannot compare. Failed/skipped: ${failed.join(', ') || 'none'}. ` +
          `See the "[name] Failed" line(s) above for the cause (common ones: out of disk space in the working dir, ` +
          `clone/auth failure, or a missing baseline ref). Try a disk-backed --working-dir if the default temp is a small tmpfs.`
        );
      }

      // 2. Compare: 2 projects -> a single pair; >2 -> first-vs-rest.
      // Layout: compare/<a>-vs-<b>/<newerA>__<newerB>__<ts>/report.{json,md}
      // (the folder names the two compared versions — the actual deliverable).
      const base = generated[0];
      for (let i = 1; i < generated.length; i++) {
        const other = generated[i];
        console.log(`\nComparing ${base.name} vs ${other.name}...`);
        const result = await compareReports(base.jsonPath, other.jsonPath, compareOpts);

        const dir = join(
          outputDir, 'compare', `${safeSeg(base.name)}-vs-${safeSeg(other.name)}`,
          `${safeSeg(base.newer)}__${safeSeg(other.newer)}__${runTs}`
        );
        await mkdir(dir, { recursive: true });

        const jsonPath = join(dir, 'report.json');
        await writeFile(jsonPath, JSON.stringify(result, null, 2));
        console.log(`📄 JSON: ${jsonPath}`);
        console.log(`   Discrepancies: ${result.summary.totalDiscrepancies}, matching: ${result.summary.totalMatching}`);

        // Back-links from the compare report to each project's report.md,
        // relative to the compare report's own location.
        const mdPath = join(dir, 'report.md');
        const projectLinks = [relative(dir, base.mdPath), relative(dir, other.mdPath)];
        await generateCompareMarkdown(result, mdPath, { projectLinks });
        console.log(`📝 Markdown: ${mdPath}`);
      }

      console.log('\nProjects comparison complete!');
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
);

// Default action when no subcommand is provided
const defaultAction = async () => {
  console.log('🔍 Dependency Change Report\n');

  // Try to detect if we're in a git repository
  let repoUrl = null;
  let isInGitRepo = false;

  try {
    const result = await executeCommand('git', ['remote', 'get-url', 'origin'], process.cwd(), 10000, 'detecting git remote');
    repoUrl = result?.trim();
    isInGitRepo = !!repoUrl;
  } catch (error) {
    // Not in a git repo or no remote
  }

  if (isInGitRepo) {
    console.log(`✅ Detected git repository: ${repoUrl}\n`);

    // Try to detect versions
    try {
      const { newer, older } = await detectVersions('.');
      console.log(`✅ Detected versions:`);
      console.log(`   Older: ${older}`);
      console.log(`   Newer: ${newer}\n`);

      console.log('📋 Ready to analyze! Run one of these commands:\n');
      console.log('   # Auto-detect versions and generate all reports:');
      console.log('   dependency-change-report auto --ignore-dev\n');
      console.log('   # Or specify versions explicitly:');
      console.log(`   dependency-change-report compare --ignore-dev ${older} ${newer}\n`);
      console.log('   # Generate specific report formats:');
      console.log(`   dependency-change-report auto --html --markdown\n`);

    } catch (error) {
      console.log(`⚠️  Could not auto-detect versions: ${error.message}\n`);
      console.log('📋 Run with explicit versions:\n');
      console.log('   dependency-change-report compare <older-version> <newer-version>\n');
      console.log('   Example:');
      console.log('   dependency-change-report compare v1.0.0 v2.0.0\n');
    }

  } else {
    console.log('⚠️  Not in a git repository or no remote configured\n');
    console.log('📋 Run from a git repository:\n');
    console.log('   cd /path/to/your/repo');
    console.log('   dependency-change-report auto\n');
    console.log('📋 Or specify a repository URL:\n');
    console.log('   dependency-change-report compare https://github.com/user/repo v1.0.0 v2.0.0\n');
  }

  console.log('💡 Additional options:');
  console.log('   --ignore-dev            Ignore dev dependencies');
  console.log('   --debug-tree            Show debug info about dependency filtering');
  console.log('   --cleanup-worktrees     Clean up stale git worktrees before starting');
  console.log('   --skip-full-inventory   Skip full dependency inventory (enabled by default)');
  console.log('   --output-dir <path>     Save reports to specific directory');
  console.log('   --html                  Generate HTML report only');
  console.log('   --markdown              Generate Markdown report only');
  console.log('   --text                  Generate text report only\n');

  console.log('📚 For more help:');
  console.log('   dependency-change-report --help');
};

const cmd = command('dependency-change-report', summary('show dependency changes between versions'), compare, auto, projects)
const init = async () => {
  // If no arguments provided (just the command name), run default action
  if (process.argv.length === 2) {
    await defaultAction();
  } else {
    cmd.parse();
  }
}

// Run the main function
init();
