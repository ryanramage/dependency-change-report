import { readdir, rm } from 'fs/promises';
import { join } from 'path';

/**
 * Reduce a node_modules directory to just package.json files: for each
 * top-level package (including scoped `@scope/pkg`), delete every entry except
 * package.json. This drops source, binaries, `.bin`, and nested node_modules
 * while keeping the metadata the analyzer still reads afterward (repository
 * URLs from top-level package.json). Best-effort — missing dirs and per-entry
 * errors are ignored.
 *
 * @param {string} nmDir - path to a node_modules directory
 * @returns {Promise<void>}
 */
export const pruneNodeModulesToPackageJson = async (nmDir) => {
  let entries;
  try {
    entries = await readdir(nmDir, { withFileTypes: true });
  } catch {
    return; // nothing to prune (no node_modules)
  }

  // Within a single package dir, delete everything except package.json.
  const prunePackage = async (pkgDir) => {
    let items;
    try {
      items = await readdir(pkgDir);
    } catch {
      return;
    }
    await Promise.all(
      items
        .filter((name) => name !== 'package.json')
        .map((name) => rm(join(pkgDir, name), { recursive: true, force: true }).catch(() => {}))
    );
  };

  for (const entry of entries) {
    const full = join(nmDir, entry.name);

    // Drop stray files (e.g. .package-lock.json) and hidden dirs (.bin, .cache).
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      await rm(full, { recursive: true, force: true }).catch(() => {});
      continue;
    }

    // Scoped packages: prune each package inside the scope directory.
    if (entry.name.startsWith('@')) {
      let scoped;
      try {
        scoped = await readdir(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        if (s.isDirectory()) await prunePackage(join(full, s.name));
      }
      continue;
    }

    await prunePackage(full);
  }
};
