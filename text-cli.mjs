#!/usr/bin/env node

import { generateTextReport } from './generate-text.mjs';
import { dirname, join } from 'path';

// CLI interface
const main = async () => {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('Usage: node text-cli.mjs <report.json> [output.txt]');
      process.exit(1);
    }
    
    const [jsonPath, outputPath] = args;
    
    // If no output path specified, create report.txt in the same directory as the JSON file
    const finalOutputPath = outputPath || join(dirname(jsonPath), 'report.txt');
    
    await generateTextReport(jsonPath, finalOutputPath);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the main function
main();
