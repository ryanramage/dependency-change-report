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

/**
 * Does a package spec look like a glob pattern? Mirrors the heuristic used by
 * parseDcrIgnoreFile so `.dcr.json` `ignore` entries split the same way.
 */
const isGlob = (s) => s.includes('*') || s.includes('?') || s.includes('[') || s.includes(']');

/**
 * Split a list of ignore entries into exact matches and glob patterns.
 * @param {string[]} entries
 * @returns {{exactMatches: Set<string>, patterns: string[]}}
 */
export const splitIgnoreEntries = (entries = []) => {
  const exactMatches = new Set();
  const patterns = [];
  for (const raw of entries) {
    const entry = typeof raw === 'string' ? raw.trim() : '';
    if (!entry) continue;
    if (isGlob(entry)) patterns.push(entry);
    else exactMatches.add(entry);
  }
  return { exactMatches, patterns };
};

/**
 * Merge ignore rules from config `ignore[]`, an optional CLI list, and a parsed
 * `.dcrignore` result into a single set of exact matches + patterns. Additive
 * (union), not precedence — all sources always apply.
 * @param {string[]|undefined} cliIgnore
 * @param {Object} config - parsed .dcr.json
 * @param {{exactMatches: Set<string>, patterns: string[]}} dcrIgnore
 * @returns {{exactMatches: Set<string>, patterns: string[]}}
 */
export const resolveIgnore = (cliIgnore, config = {}, dcrIgnore = { exactMatches: new Set(), patterns: [] }) => {
  const configEntries = Array.isArray(config.ignore) ? config.ignore : [];
  const cliEntries = Array.isArray(cliIgnore) ? cliIgnore : (cliIgnore ? [cliIgnore] : []);
  const fromConfig = splitIgnoreEntries([...configEntries, ...cliEntries]);
  const exactMatches = new Set([...dcrIgnore.exactMatches, ...fromConfig.exactMatches]);
  const patterns = [...new Set([...dcrIgnore.patterns, ...fromConfig.patterns])];
  return { exactMatches, patterns };
};

/**
 * Resolve a boolean setting: CLI flag can only turn it ON; otherwise fall back
 * to the config value, else false. (paparam booleans are false when absent.)
 */
export const resolveIgnoreDev = (cliFlag, config = {}) =>
  cliFlag === true ? true : config.ignoreDev === true;

export const resolveSkipFullInventory = (cliFlag, config = {}) =>
  cliFlag === true ? true : config.skipFullInventory === true;

/**
 * Resolve output settings with precedence CLI > config > default.
 * @param {string|undefined} cliDir - value of --output-dir
 * @param {{html?:boolean, markdown?:boolean, text?:boolean}} cliFormats
 * @param {Object} config - parsed .dcr.json
 * @returns {{dir: string|null, formats: string[]|null}} - null means "caller keeps its own default"
 */
export const resolveOutput = (cliDir, cliFormats = {}, config = {}) => {
  const out = config.output || {};
  const dir = cliDir || out.dir || null;

  const cliSelected = ['html', 'markdown', 'text'].filter((f) => cliFormats[f]);
  let formats = null;
  if (cliSelected.length > 0) {
    formats = cliSelected;
  } else if (Array.isArray(out.formats) && out.formats.length > 0) {
    formats = out.formats;
  }
  return { dir, formats };
};

/**
 * Read and validate the `projects` list from a compare-repo's .dcr.json.
 * Each project needs `name` and at least one of `path`/`repo`; invalid entries
 * are warned about and skipped.
 * @returns {Promise<Array<{name:string, path?:string, repo?:string, ref?:string, baseline?:string}>>}
 */
export const readProjects = async (compareRepoPath = '.', configFile = '.dcr.json') => {
  const config = await readDcrConfig(compareRepoPath, configFile);
  const raw = Array.isArray(config.projects) ? config.projects : [];
  const projects = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object' || !p.name || (!p.path && !p.repo)) {
      console.warn(`Warning: skipping invalid project entry (needs "name" and one of "path"/"repo"): ${JSON.stringify(p)}`);
      continue;
    }
    projects.push(p);
  }
  return projects;
};

/**
 * Read cross-repo compare options from a compare-repo's .dcr.json `compare`
 * block, mapped to the shape compareReports() expects.
 * @returns {Promise<{excludePatterns:string[], includePatterns:string[], ignoreDev:boolean, includeNested:boolean}>}
 */
export const readCompareOptions = async (compareRepoPath = '.', configFile = '.dcr.json') => {
  const config = await readDcrConfig(compareRepoPath, configFile);
  const c = config.compare || {};
  return {
    excludePatterns: Array.isArray(c.filter) ? c.filter : [],
    includePatterns: Array.isArray(c.only) ? c.only : [],
    ignoreDev: c.ignoreDev === true,
    includeNested: c.includeNested === true
  };
};
