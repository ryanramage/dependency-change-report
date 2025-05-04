#!/usr/bin/env node

import { generateHtmlReport } from './generate-html.mjs';

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node html-cli.mjs <report.json> [output.html]');
      process.exit(1);
    }
    
    const [jsonPath, outputPath] = args;
    
    await generateHtmlReport(jsonPath, outputPath);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
main();
