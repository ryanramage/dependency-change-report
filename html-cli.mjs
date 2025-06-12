#!/usr/bin/env node

import { generateHtmlReport } from './generate-html.mjs';
import { dirname, join } from 'path';

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node html-cli.mjs <report.json> [output.html]');
      process.exit(1);
    }
    
    const [jsonPath, outputPath] = args;
    
    // If no output path specified, create report.html in the same directory as the JSON file
    const finalOutputPath = outputPath || join(dirname(jsonPath), 'report.html');
    
    await generateHtmlReport(jsonPath, finalOutputPath);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
main();
