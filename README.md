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

## Requirements

- Node.js 14 or higher
- Git
- npm

## GitHub Actions Integration

This tool is designed to work seamlessly with GitHub Actions to automatically generate dependency reports for pull requests and releases.

### Basic Setup

Create `.github/workflows/dependency-report.yml` in your repository:

```yaml
name: Dependency Change Report
on:
  pull_request:
    branches: [ main ]

jobs:
  dependency-report:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0  # Need full history for version detection
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Generate dependency report
        run: npx dependency-change-report auto --output-dir ./reports
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Upload reports as artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dependency-reports
          path: ./reports/
          retention-days: 30
```

### Advanced Setup with PR Comments

For automatic PR comments with the dependency report:

```yaml
name: Dependency Change Report
on:
  pull_request:
    branches: [ main ]

jobs:
  dependency-report:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Generate dependency report
        id: dep-report
        run: npx dependency-change-report auto --output-dir ./reports
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Upload reports as artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dependency-report-PR-${{ github.event.number }}
          path: ./reports/
          retention-days: 30
      
      - name: Comment PR with report
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const path = './reports/dependency-report-PR-${{ github.event.number }}.md';
            if (fs.existsSync(path)) {
              const report = fs.readFileSync(path, 'utf8');
              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: report
              });
            }
```

### Compare Specific Versions

To compare specific commits or tags instead of auto-detection:

```yaml
      - name: Generate dependency report
        run: npx dependency-change-report compare https://github.com/${{ github.repository }} ${{ github.event.pull_request.base.sha }} ${{ github.event.pull_request.head.sha }} --output-dir ./reports
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Private Repository Support

For private repositories, the tool automatically detects GitHub Actions environment and configures Git authentication using the provided `GITHUB_TOKEN`. Make sure to:

1. **Include the token in your workflow step**:
   ```yaml
   env:
     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

2. **Set appropriate permissions** in your workflow:
   ```yaml
   permissions:
     contents: read
     actions: read
     pull-requests: write  # Only needed for PR comments
   ```

3. **Use the token in checkout** for private repositories:
   ```yaml
   - uses: actions/checkout@v4
     with:
       token: ${{ secrets.GITHUB_TOKEN }}
       fetch-depth: 0
   ```

The tool will automatically configure Git to use the token for authentication when accessing private repositories.

### Available Outputs

When running in GitHub Actions, the tool provides these outputs that can be used in subsequent steps:

- `has-changes`: `true` if any dependencies changed
- `added-count`: Number of added dependencies
- `upgraded-count`: Number of upgraded dependencies  
- `removed-count`: Number of removed dependencies
- `report-dir`: Directory containing the generated reports

### Generated Files

In GitHub Actions, the tool automatically generates files with PR-specific names:

- `dependency-report-PR-123.html` - Interactive HTML report
- `dependency-report-PR-123.md` - Markdown report (perfect for PR comments)
- `dependency-report-PR-123.txt` - Plain text report
- `report.json` - Raw JSON data

### Accessing Reports

Reports are saved as GitHub Actions artifacts and can be:

1. **Downloaded from the Actions tab** - Click on the workflow run and download the artifact
2. **Viewed in PR comments** - If using the advanced setup with PR comments
3. **Accessed programmatically** - Using the GitHub API to download artifacts

## License

ISC
