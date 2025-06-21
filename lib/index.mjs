#!/usr/bin/env node

import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import semver from 'semver';
import os from 'os';
import https from 'https';
import PQueue from 'p-queue';

// Import utilities
import { executeCommand, time_10min, time_5min, time_2min, time_1min } from './utils/command-executor.mjs';
import { setupSignalHandlers, registerTempDir, unregisterTempDir } from './utils/cleanup-manager.mjs';
import { createMultiProgressBar, stopMultiProgressBar, shouldUseProgressBars } from './utils/progress-manager.mjs';

// Import core analyzer
import { analyzeDependencyChanges } from './core/analyzer.mjs';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);




export { analyzeDependencyChanges };
