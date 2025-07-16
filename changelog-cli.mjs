#!/usr/bin/env node

import { generateChangelogReport } from './lib/generate-changelog.mjs';

/**
 * CLI interface for generating CHANGELOG-style dependency reports
 * @returns {Promise<void>}
 */
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node changelog-cli.mjs <report.json> [output-path] [--llm-command <command>]');
      console.error('');
      console.error('Generate a CHANGELOG-style report from a dependency analysis JSON file.');
      console.error('');
      console.error('Arguments:');
      console.error('  <report.json>     Path to the JSON report file from dependency analysis');
      console.error('  [output-path]     Optional output path for the changelog (default: auto-generated)');
      console.error('  --llm-command     LLM command to use for summarization (default: ollama)');
      console.error('');
      console.error('Examples:');
      console.error('  node changelog-cli.mjs report.json');
      console.error('  node changelog-cli.mjs report.json CHANGELOG-deps.md');
      console.error('  node changelog-cli.mjs report.json --llm-command "llm -m gpt-4"');
      process.exit(1);
    }
    
    let jsonPath = args[0];
    let outputPath = null;
    let llmCommand = 'ollama';
    
    // Parse arguments
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--llm-command') {
        if (i + 1 < args.length) {
          llmCommand = args[i + 1];
          i++; // Skip next argument as it's the command
        } else {
          console.error('Error: --llm-command requires a value');
          process.exit(1);
        }
      } else if (!outputPath && !args[i].startsWith('--')) {
        outputPath = args[i];
      }
    }
    
    console.log(`Generating CHANGELOG from ${jsonPath}...`);
    console.log(`Using LLM command: ${llmCommand}`);
    
    const changelogPath = await generateChangelogReport(jsonPath, outputPath, llmCommand);
    
    console.log('\n✅ CHANGELOG generated successfully!');
    console.log(`📝 Output: ${changelogPath}`);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
main();
