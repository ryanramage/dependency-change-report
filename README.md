# Deep Depends Report

A tool to analyze dependency changes between different versions of a Node.js project and generate detailed reports with changelogs.

## Features

- Compare dependencies between two versions of a repository
- Identify added, upgraded, removed, and modified dependencies
- Generate changelogs for upgraded dependencies by analyzing commit history
- Detect namespace changes in dependencies (e.g., from `package` to `@org/package`)
- Create HTML reports with detailed information
- Track and report errors during changelog generation

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/deep-depends-report.git
cd deep-depends-report

# Install dependencies
npm install

# Make CLI scripts executable
chmod +x cli.mjs html-cli.mjs
```

For global installation:

```bash
npm install -g .
```

## Usage

### Command Line Interface

Generate a dependency report:

```bash
# Using node directly
node cli.mjs <github-repo> <older-version> <newer-version> [working-dir]

# Using npm script
npm run report -- <github-repo> <older-version> <newer-version> [working-dir]

# If installed globally
deep-depends-report <github-repo> <older-version> <newer-version> [working-dir]
```

Generate an HTML report from a JSON report:

```bash
# Using node directly
node html-cli.mjs <report.json> [output.html]

# Using npm script
npm run html -- <report.json> [output.html]

# If installed globally
deep-depends-html <report.json> [output.html]
```

### Examples

```bash
# Generate a report comparing v1.0.0 and v2.0.0 of a repository
node cli.mjs git@github.com:user/repo.git v1.0.0 v2.0.0

# Generate an HTML report from a JSON report
node html-cli.mjs ./repo-name-2023-05-04T12-34-56-789Z/report.json ./report.html
```

### Programmatic Usage

You can also use the tool programmatically in your own Node.js projects:

```javascript
import { analyzeDependencyChanges } from 'deep-depends-report';
import { generateHtmlReport } from 'deep-depends-report/generate-html.mjs';

// Generate a dependency report
const report = await analyzeDependencyChanges(
  'git@github.com:user/repo.git',
  'v1.0.0',
  'v2.0.0'
);

// Generate an HTML report from a JSON report
await generateHtmlReport('./path/to/report.json', './path/to/output.html');
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
