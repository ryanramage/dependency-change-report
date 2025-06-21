import { join, basename } from 'path';
import { readFile } from 'fs/promises';
import { executeCommand, time_10min } from '../utils/command-executor.mjs';

/**
 * Install npm dependencies
 * @param {string} dir - Directory containing package.json
 * @param {boolean} enablePeriodicLogging - Whether to enable periodic logging for long operations
 * @returns {Promise<void>}
 */
export const installDependencies = async (dir, enablePeriodicLogging = false) => {
  try {
    const dirName = basename(dir);
    await executeCommand('npm', ['install'], dir, time_10min, `npm install in ${dirName}`, enablePeriodicLogging);
  } catch (error) {
    throw error;
  }
};

/**
 * Get npm dependencies
 * @param {string} dir - Directory containing node_modules
 * @param {string} namespace - Optional namespace to filter second-level dependencies
 * @returns {Promise<Object>} - Dependencies object
 */
export const getDependencies = async (dir, namespace = null) => {
  try {
    const output = await executeCommand('npm', ['ls', '--all', '--omit=dev', '--json'], dir);
    const dependencies = JSON.parse(output).dependencies || {};
    
    // Enhance dependencies with repository information
    for (const [name, info] of Object.entries(dependencies)) {
      try {
        const packageDir = join(dir, 'node_modules', name);
        const packageJsonPath = join(packageDir, 'package.json');
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
        
        // Extract repository URL
        if (packageJson.repository) {
          if (typeof packageJson.repository === 'string') {
            info.repository = packageJson.repository;
          } else if (packageJson.repository.url) {
            info.repository = packageJson.repository.url;
          }
        }
        
        // Get second-level dependencies if they exist
        if (packageJson.dependencies) {
          // Get the nested dependencies
          const nestedDeps = {};
          for (const [nestedName, nestedVersion] of Object.entries(packageJson.dependencies)) {
            // If namespace is provided, only include dependencies in that namespace
            if (!namespace || nestedName.startsWith(namespace)) {
              try {
                const nestedPackageDir = join(dir, 'node_modules', nestedName);
                const nestedPackageJsonPath = join(nestedPackageDir, 'package.json');
                const nestedPackageJson = JSON.parse(await readFile(nestedPackageJsonPath, 'utf8'));
                
                nestedDeps[nestedName] = { 
                  version: nestedVersion,
                  repository: null
                };
                
                // Extract repository URL for nested dependency
                if (nestedPackageJson.repository) {
                  if (typeof nestedPackageJson.repository === 'string') {
                    nestedDeps[nestedName].repository = nestedPackageJson.repository;
                  } else if (nestedPackageJson.repository.url) {
                    nestedDeps[nestedName].repository = nestedPackageJson.repository.url;
                  }
                }
              } catch (err) {
                // Silently skip nested dependencies we can't read
              }
            }
          }
          
          // Only add nested dependencies if there are any (after filtering)
          if (Object.keys(nestedDeps).length > 0) {
            info.dependencies = nestedDeps;
          }
        }
      } catch (err) {
        // Silently skip dependencies we can't read
      }
    }
    
    return dependencies;
  } catch (error) {
    // Silently return empty object if we can't get dependencies
    // Return empty object if we can't get dependencies
    return {};
  }
};
