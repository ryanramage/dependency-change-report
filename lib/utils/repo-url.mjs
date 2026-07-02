const KNOWN_HOSTS = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

/**
 * Normalize a package's `repository` URL into a clone-able SSH git URL, or null
 * if it can't be confidently parsed.
 *
 * Handles: `git+https://`, `git+ssh://`, `git://`, `ssh://`, `https://`,
 * scp-style `git@host:owner/repo`, and `github:`/`gitlab:`/`bitbucket:`
 * shorthand. The real host is preserved. Only the first two path segments
 * (owner/repo) are kept, so web-path suffixes from monorepo repository fields
 * (e.g. `.../redux-saga/tree/main/packages/core`) and any `#hash`/`?query` are
 * dropped — this is the class of URL that previously produced uncloneable
 * `.../tree/main/packages/core.git` values.
 *
 * @param {string} raw
 * @returns {string|null} e.g. `git@github.com:owner/repo.git`
 */
export const normalizeRepoUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^git\+/, '');

  let host = null;
  let pathPart = null;

  const shorthand = s.match(/^(github|gitlab|bitbucket):(.+)$/i);
  const scp = s.match(/^[^@\s]+@([^:/]+):(.+)$/); // git@host:owner/repo(.git)
  const url = s.match(/^(?:https?|git|ssh):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);

  if (shorthand) {
    host = KNOWN_HOSTS[shorthand[1].toLowerCase()];
    pathPart = shorthand[2];
  } else if (scp) {
    host = scp[1];
    pathPart = scp[2];
  } else if (url) {
    host = url[1];
    pathPart = url[2];
  } else {
    return null;
  }

  if (!host || !pathPart) return null;

  // Drop query/hash, then keep only owner/repo (first two path segments).
  const segs = pathPart.split(/[?#]/)[0].split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (!owner || !repo) return null;

  return `git@${host}:${owner}/${repo}.git`;
};

/**
 * Convert any repository URL to a browser-friendly https:// display URL.
 * @param {string} url
 * @returns {string|null}
 */
export const toDisplayUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const normalized = normalizeRepoUrl(url) || url;
  const m = normalized.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  return normalized.replace(/^git\+/, '').replace(/\.git$/, '');
};

/**
 * Normalize a dependency version into something resolvable to a git tag:
 * strips a leading range operator (`^`, `~`, `>=`, `<=`, `>`, `<`, `=`) and
 * whitespace. Returns null for missing/empty/`undefined`/`null` values so
 * callers can skip a range they can't compute rather than failing slowly.
 * @param {string|undefined|null} v
 * @returns {string|null}
 */
export const normalizeVersion = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/^[\^~]/, '').replace(/^(?:>=|<=|>|<|=)\s*/, '').trim();
  if (!s || s === 'undefined' || s === 'null' || s === '*') return null;
  return s;
};
