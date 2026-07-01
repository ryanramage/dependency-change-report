import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';

/**
 * Read an optional .dcr.json config file from a repository.
 *
 * The config is used to anchor a comparison baseline for a release train,
 * e.g. `{ "baseline": "v4.2.0" }`. Missing or malformed files resolve to an
 * empty object so callers can always fall back to auto-detection.
 *
 * @param {string} repoPath - Path to the repository root
 * @param {string} configFile - Config filename or path (default: .dcr.json)
 * @returns {Promise<Object>} Parsed config, or {} if absent/unreadable
 */
export const readDcrConfig = async (repoPath = '.', configFile = '.dcr.json') => {
  const configPath = isAbsolute(configFile) ? configFile : join(repoPath, configFile);
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Warning: ignoring malformed config at ${configPath}: ${error.message}`);
    }
    return {};
  }
};

/**
 * Resolve the comparison baseline ("older" ref) using precedence:
 *   1. explicit base-ref override (CLI flag / action input)
 *   2. `baseline` field in .dcr.json
 *   3. null (caller falls back to auto-detection)
 *
 * @param {string|undefined} baseRefOverride - explicit override, if any
 * @param {string} repoPath - Path to the repository root
 * @param {string} configFile - Config filename or path
 * @returns {Promise<string|null>} The resolved baseline, or null for auto
 */
export const resolveBaseline = async (baseRefOverride, repoPath = '.', configFile = '.dcr.json') => {
  if (baseRefOverride) return baseRefOverride;
  const config = await readDcrConfig(repoPath, configFile);
  return config.baseline || null;
};
