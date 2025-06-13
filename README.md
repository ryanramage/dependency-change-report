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

No installation required! Run directly with npx:

```bash
npx dependency-change-report <github-repo> <older-version> <newer-version> [working-dir]
```

### Global Installation (Alternative)

For frequent use, you can install globally:

```bash
npm install -g dependency-change-report
```

Then run with:

```bash
dependency-change-report <github-repo> <older-version> <newer-version> [working-dir]
```

## Usage

### Command Line Interface

Generate a dependency report:

```bash
# Using npx (recommended)
npx dependency-change-report <github-repo> <older-version> <newer-version> [working-dir]

# If installed globally
dependency-change-report <github-repo> <older-version> <newer-version> [working-dir]
```

The tool automatically generates three report formats:
- `report.json` - Raw data in JSON format
- `report.html` - Web-friendly HTML report
- `report.txt` - Slack-friendly text report

### Examples

```bash
# Generate a report comparing v1.0.0 and v2.0.0 of a repository
npx dependency-change-report git@github.com:user/repo.git v1.0.0 v2.0.0

# Generate a report with a specific working directory
npx dependency-change-report git@github.com:user/repo.git v1.0.0 v2.0.0 /tmp/analysis

# Filter nested dependencies by namespace (e.g., @holepunch)
npx dependency-change-report git@github.com:user/repo.git v1.0.0 v2.0.0 . @holepunch
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

## License

ISC
