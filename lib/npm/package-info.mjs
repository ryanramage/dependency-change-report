import { join } from 'path';
import { readFile } from 'fs/promises';
import { normalizeRepoUrl } from '../utils/repo-url.mjs';

/**
 * Get the repository URL (and monorepo subdirectory, if any) from a package's
 * package.json. The URL is normalized to a clone-able form; `directory` comes
 * from `repository.directory` for monorepo packages (used to scope changelogs).
 * @param {string} packageDir - Path to the package directory
 * @returns {Promise<{url: string|null, directory: string|null}>}
 */
export const getRepositoryUrl = async (packageDir) => {
  try {
    const packageJsonPath = join(packageDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

    let rawUrl = null;
    let directory = null;
    if (packageJson.repository) {
      if (typeof packageJson.repository === 'string') {
        rawUrl = packageJson.repository;
      } else {
        rawUrl = packageJson.repository.url || null;
        directory = packageJson.repository.directory || null;
      }
    }

    let url = rawUrl ? normalizeRepoUrl(rawUrl) : null;

    // If no (usable) repository URL, infer from the package name.
    if (!url && packageJson.name) {
      if (packageJson.name.startsWith('@')) {
        const [scope, packageName] = packageJson.name.substring(1).split('/');
        if (scope && packageName) {
          console.log(`No repository URL found for ${packageJson.name}, inferring from package name...`);
          url = `git@github.com:${scope}/${packageName}.git`;
        }
      } else {
        console.log(`No repository URL found for ${packageJson.name}, inferring from package name...`);
        url = `git@github.com:${packageJson.name}/${packageJson.name}.git`;
      }
    }

    return { url, directory };
  } catch (error) {
    return { url: null, directory: null };
  }
};

/**
 * Normalize a raw repository URL to a clone-able git URL.
 * Thin wrapper around normalizeRepoUrl, kept for backward compatibility.
 * @param {string} repoUrl
 * @returns {string|null}
 */
export const cleanRepositoryUrl = (repoUrl) => normalizeRepoUrl(repoUrl);
