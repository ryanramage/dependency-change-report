# Dependency Change Report

A tool to analyze dependency changes between different versions of a Node.js project and generate detailed reports with changelogs.

## Features

- Compare dependencies between two versions of a repository
- Identify added, upgraded, removed, and modified dependencies
- Generate changelogs for upgraded dependencies by analyzing commit history
- Detect namespace changes in dependencies (e.g., from `package` to `@org/package`)
- Create HTML reports with detailed information
- Track and report errors during changelog generation

## Installation

### Using npx (Recommended)

No installation required! Run directly with npx from within your git repository:

```bash
# Auto-detect versions
npx dependency-change-report auto

# Or compare specific versions
npx dependency-change-report compare v1.0.0 v2.0.0
```

### Global Installation (Alternative)

For frequent use, you can install globally:

```bash
npm install -g dependency-change-report
```

Then run with:

```bash
# Auto-detect versions
dependency-change-report auto

# Or compare specific versions
dependency-change-report compare v1.0.0 v2.0.0
```

## Usage

### Command Line Interface

The tool provides two main commands:

#### Auto Command (Recommended)

Automatically detects versions and generates reports:

```bash
# From within a git repository
dependency-change-report auto

# Or specify a repository URL
dependency-change-report auto <github-repo>
```

#### Compare Command

Compare specific versions:

```bash
# From within a git repository (repo URL auto-detected)
dependency-change-report compare <older-version> <newer-version>

# Or specify a repository URL explicitly
dependency-change-report compare --repo <github-repo> <older-version> <newer-version>
```

The tool automatically generates three report formats:
- `report.json` - Raw data in JSON format
- `report.html` - Web-friendly HTML report
- `report.md` - Markdown report (perfect for PR comments)
- `report.txt` - Plain text report

### Examples

```bash
# Auto-detect versions and generate all reports (from within a git repo)
dependency-change-report auto

# Compare specific versions (from within a git repo)
dependency-change-report compare v1.0.0 v2.0.0

# Compare specific versions with explicit repo URL
dependency-change-report compare --repo https://github.com/user/repo v1.0.0 v2.0.0

# Generate only HTML and Markdown reports
dependency-change-report auto --html --markdown

# Ignore dev dependencies
dependency-change-report compare v1.0.0 v2.0.0 --ignore-dev

# Save reports to a specific directory
dependency-change-report auto --output-dir ./reports
```

### Programmatic Usage

You can also use the tool programmatically in your own Node.js projects:

```javascript
import { analyzeDependencyChanges } from 'dependency-change-report';
import { generateHtmlReport } from 'dependency-change-report/lib/generate-html.mjs';
import { generateTextReport } from 'dependency-change-report/lib/generate-text.mjs';

// Generate a dependency report
const report = await analyzeDependencyChanges(
  'git@github.com:user/repo.git',
  'v1.0.0',
  'v2.0.0'
);

// Generate an HTML report from a JSON report
await generateHtmlReport('./path/to/report.json', './path/to/output.html');

// Generate a text report from a JSON report
await generateTextReport('./path/to/report.json', './path/to/output.txt');
```

## Report Structure

The generated JSON report includes:

- Repository information
- Version comparison details
- Lists of added, upgraded, removed, and modified dependencies
- Changelogs with commit history for upgraded dependencies
- Error information for dependencies that couldn't be analyzed

The HTML report provides a user-friendly visualization of this data, including:

- Summary statistics
- Detailed tables of dependency changes
- Commit history for upgraded dependencies
- Error information

## How It Works

1. Clones the repository at both the older and newer versions
2. Installs dependencies for both versions
3. Compares the dependency trees to identify changes
4. For each upgraded dependency, clones its repository and analyzes commit history
5. Generates a JSON report with all the collected information
6. Optionally converts the JSON report to an HTML report

## Ignoring Dependencies

### Using .dcrignore

You can exclude specific dependencies from your reports by creating a `.dcrignore` file in your repository root. This is useful for:

- Excluding internal or proprietary packages
- Filtering out dependencies that don't need tracking
- Reducing report noise by ignoring specific packages

#### Format

The `.dcrignore` file uses a simple format:
- One package name or pattern per line
- Comments start with `#`
- Empty lines are ignored
- Whitespace is automatically trimmed
- Supports glob patterns using `*`, `?`, `[...]` syntax

#### Example

```
# Ignore test utilities (exact matches)
jest
mocha

# Ignore all @jest packages (glob pattern)
@jest/*

# Ignore all @types packages (glob pattern)
@types/*

# Ignore build tools
webpack
rollup
esbuild

# Internal packages with wildcard
@mycompany/*

# Complex patterns
babel-plugin-*
*-loader
```

#### Glob Pattern Support

The `.dcrignore` file supports standard glob patterns:

- `*` - Matches any number of characters (except `/`)
- `?` - Matches a single character
- `[abc]` - Matches any character in the set
- `[a-z]` - Matches any character in the range

Examples:
- `@types/*` - Matches all packages in the @types namespace
- `babel-*` - Matches all packages starting with "babel-"
- `*-loader` - Matches all packages ending with "-loader"
- `@mycompany/*` - Matches all packages in the @mycompany namespace

#### Behavior

When a package is listed in `.dcrignore`:
- It will be excluded from the report along with all its nested dependencies
- Works the same way as `--ignore-dev` flag
- Applies to both direct and transitive dependencies
- The ignored packages are listed in the JSON report under `ignoredFromDcrIgnore`

#### Using with --ignore-dev

The `.dcrignore` file works in combination with the `--ignore-dev` flag:

```bash
# Ignore both dev dependencies AND packages in .dcrignore
dependency-change-report auto --ignore-dev
```

Both lists are merged together, so packages will be excluded if they appear in either:
- The `devDependencies` section of `package.json`
- The `.dcrignore` file

## Requirements

- Node.js 14 or higher
- Git
- npm

## GitHub Actions Integration

Two reusable composite actions ship from this repo:

| Action | Use |
|---|---|
| `ryanramage/dependency-change-report@v2` | Per-repo: generate a report against the last release line, with private npm auth, and publish `report.json` to a central reports repo. |
| `ryanramage/dependency-change-report/compare-action@v2` | Cross-repo: compare two repos' published reports (e.g. Electron vs React Native) to surface dependency drift. |

Copy-paste workflows live in [`examples/`](./examples). The two-frontend pattern below (one Electron repo + one React Native repo per product, both consuming private `@company/*` packages) is the primary use case.

> **Action ↔ npm lockstep:** the action's major version tracks the npm major. Reference `@v2` to run the `2.x` line. By default the action runs the CLI bundled at that ref; set `cli-version` to run a published npm version via `npx` instead.

### Setup (one-time, per org)

1. **Central reports repo.** Create a private repo, e.g. `acme/dcr-reports`. Each build commits its `report.json` here at a deterministic path so the sibling repo can read it:

   ```
   <product>/<repo-kind>/<event>/<ref-or-pr>/report.json
     acme/electron/pr/123/report.json
     acme/react-native/branch/main/report.json
     acme/electron/tag/v4.3.0/report.json
   ```

2. **Tokens (org secrets).** The default `${{ github.token }}` is repo-scoped and generally **cannot** read packages published from other repos or write to the reports repo. Provision an org PAT or GitHub App token:
   - `DCR_PACKAGES_TOKEN` — `packages:read` (to install private `@company/*` deps).
   - `DCR_REPORTS_TOKEN` — `contents:write` on the central reports repo.

### Per-repo report workflow

Drop [`examples/dependency-report.yml`](./examples/dependency-report.yml) into each frontend repo as `.github/workflows/dependency-report.yml`, changing only `repo-kind` (`electron` | `react-native`):

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0      # full history — version detection lists tags
    fetch-tags: true
- uses: ryanramage/dependency-change-report@v2
  with:
    product: acme
    repo-kind: electron
    github-packages-scopes: '@company,@company-internal'
    github-packages-token: ${{ secrets.DCR_PACKAGES_TOKEN }}
    reports-repo: acme/dcr-reports
    reports-token: ${{ secrets.DCR_REPORTS_TOKEN }}
```

#### How private npm auth works (the part that used to fail)

The tool builds each version in a **git worktree** of your checkout, and runs `npm install` there. A project-level `.npmrc` written at runtime is *not* visible inside worktrees (they only contain committed files) — which is why ad-hoc `.npmrc` setups never worked. The action solves this by writing a **user-level `~/.npmrc`** that maps your scopes to GitHub Packages and is visible to every worktree:

```
@company:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<DCR_PACKAGES_TOKEN>
```

Set `github-packages-scopes` to the scopes you consume; the token is passed via env only (never logged). Git auth for the private repo itself continues to work via the runner's authenticated checkout.

#### Report action inputs (selected)

| Input | Default | Purpose |
|---|---|---|
| `base-ref` | `''` | Explicit baseline; overrides `.dcr.json` and auto-detection. |
| `config-file` | `.dcr.json` | Config file holding a pinned baseline. |
| `github-packages-scopes` | `''` | Comma-separated scopes mapped to GitHub Packages. |
| `github-packages-token` | `${{ github.token }}` | Token for `npm.pkg.github.com`. |
| `publish-target` | `central-repo` | `central-repo` \| `artifact` \| `none`. |
| `reports-repo` / `reports-token` | `''` | Central reports repo and its `contents:write` token. |
| `product` / `repo-kind` | `''` | Identity used to build the report path. |
| `comment-on-pr` | `true` | Post/update the markdown report as a PR comment. |
| `fail-on` | `none` | `none` \| `major` \| `any` — fail the job on changes. |

Outputs: `has-changes`, `added-count`, `upgraded-count`, `removed-count`, `older-version`, `newer-version`, `report-json-path`, `report-path` (committed location).

### Baseline anchoring (comparing to the last release line)

Baseline ("older" ref) resolves with this precedence:

1. `base-ref` action input (per-run override).
2. `baseline` field in `.dcr.json` at the repo root.
3. Auto-detection — the latest **stable** tag (pre-releases like `-rc`/`-beta` are skipped), falling back to `main`/`master`.

Pin a release train by committing a one-line `.dcr.json` (see [`examples/.dcr.json`](./examples/.dcr.json)):

```json
{ "baseline": "v4.2.0" }
```

**Recommended policy:**
- **Tag builds:** leave it on auto — it compares the released tag against the prior stable tag.
- **PR / release-branch builds:** pin the baseline via `.dcr.json` for the duration of the train (e.g. two weeks). This avoids the footgun where, once `v4.3.0` is tagged, auto-detection would compare `v4.3.0 → v4.3.0` (an empty report). Bump or remove the pin when the train ships.

The pin also works locally:

```bash
dependency-change-report auto --base-ref v4.2.0
```

### Cross-repo dependency drift

Near sprint end, compare the two repos' latest reports. Put [`examples/cross-repo-compare.yml`](./examples/cross-repo-compare.yml) in a small coordinating repo (or the reports repo itself):

```yaml
- uses: ryanramage/dependency-change-report/compare-action@v2
  with:
    reports-repo: acme/dcr-reports
    reports-token: ${{ secrets.DCR_REPORTS_TOKEN }}
    report1-path: acme/electron/branch/main/report.json
    report2-path: acme/react-native/branch/main/report.json
    filter: 'react-native*,@expo/*,electron,electron-*'
    comment-issue: '42'          # optional: post the drift summary to an issue
    # fail-on-discrepancies: 'true'
```

The compare action checks out the reports repo and runs `dependency-change-compare` against the two local files — so private reports need no special fetch handling. (If you instead point `dependency-change-compare` at a private URL directly, set `DCR_TOKEN` so `loadReport` can send an auth header.)

### Adopting on another product

A new team following the same two-repo pattern only changes `product`, `repo-kind`, and the secret names — everything else is identical.

## License

ISC
