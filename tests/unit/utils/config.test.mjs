import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readDcrConfig,
  resolveBaseline,
  splitIgnoreEntries,
  resolveIgnore,
  resolveIgnoreDev,
  resolveSkipFullInventory,
  resolveOutput,
  readProjects,
  readCompareOptions,
} from '../../../lib/utils/config.mjs';

describe('config', () => {
  let dir;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dcr-config-test-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('readDcrConfig', () => {
    it('returns {} when no config file exists', async () => {
      const config = await readDcrConfig(dir, '.dcr.json');
      assert.deepEqual(config, {});
    });

    it('parses a valid config file', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({ baseline: 'v4.2.0' }));
      const config = await readDcrConfig(dir, '.dcr.json');
      assert.equal(config.baseline, 'v4.2.0');
    });

    it('returns {} for malformed JSON instead of throwing', async () => {
      await writeFile(join(dir, 'bad.json'), '{ not valid json');
      const config = await readDcrConfig(dir, 'bad.json');
      assert.deepEqual(config, {});
    });
  });

  describe('resolveBaseline', () => {
    it('prefers the explicit override above all else', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({ baseline: 'v4.2.0' }));
      const baseline = await resolveBaseline('v9.9.9', dir, '.dcr.json');
      assert.equal(baseline, 'v9.9.9');
    });

    it('falls back to the config baseline when no override is given', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({ baseline: 'v4.2.0' }));
      const baseline = await resolveBaseline(undefined, dir, '.dcr.json');
      assert.equal(baseline, 'v4.2.0');
    });

    it('returns null when neither override nor config baseline exists', async () => {
      const baseline = await resolveBaseline(undefined, dir, 'missing.json');
      assert.equal(baseline, null);
    });
  });

  describe('splitIgnoreEntries', () => {
    it('separates exact matches from glob patterns and trims', () => {
      const { exactMatches, patterns } = splitIgnoreEntries([' jest ', '@types/*', 'mocha', 'babel-*']);
      assert.deepEqual([...exactMatches].sort(), ['jest', 'mocha']);
      assert.deepEqual(patterns.sort(), ['@types/*', 'babel-*']);
    });

    it('ignores empty and non-string entries', () => {
      const { exactMatches, patterns } = splitIgnoreEntries(['', '  ', null, 5, 'foo']);
      assert.deepEqual([...exactMatches], ['foo']);
      assert.deepEqual(patterns, []);
    });
  });

  describe('resolveIgnore', () => {
    it('unions config ignore with a .dcrignore result', () => {
      const dcrIgnore = { exactMatches: new Set(['jest']), patterns: ['@types/*'] };
      const config = { ignore: ['mocha', 'babel-*'] };
      const { exactMatches, patterns } = resolveIgnore(undefined, config, dcrIgnore);
      assert.deepEqual([...exactMatches].sort(), ['jest', 'mocha']);
      assert.deepEqual(patterns.sort(), ['@types/*', 'babel-*']);
    });

    it('dedupes patterns shared across sources', () => {
      const dcrIgnore = { exactMatches: new Set(), patterns: ['@types/*'] };
      const config = { ignore: ['@types/*'] };
      const { patterns } = resolveIgnore(undefined, config, dcrIgnore);
      assert.deepEqual(patterns, ['@types/*']);
    });

    it('handles missing config and dcrignore (empty result)', () => {
      const { exactMatches, patterns } = resolveIgnore();
      assert.equal(exactMatches.size, 0);
      assert.deepEqual(patterns, []);
    });
  });

  describe('resolveIgnoreDev / resolveSkipFullInventory', () => {
    it('flag turns on regardless of config', () => {
      assert.equal(resolveIgnoreDev(true, { ignoreDev: false }), true);
      assert.equal(resolveSkipFullInventory(true, {}), true);
    });

    it('falls back to config when flag absent', () => {
      assert.equal(resolveIgnoreDev(false, { ignoreDev: true }), true);
      assert.equal(resolveSkipFullInventory(false, { skipFullInventory: true }), true);
    });

    it('defaults to false when neither set', () => {
      assert.equal(resolveIgnoreDev(false, {}), false);
      assert.equal(resolveSkipFullInventory(undefined, {}), false);
    });
  });

  describe('resolveOutput', () => {
    it('prefers CLI dir and CLI-selected formats', () => {
      const { dir, formats } = resolveOutput('./out', { markdown: true }, { output: { dir: './cfg', formats: ['html'] } });
      assert.equal(dir, './out');
      assert.deepEqual(formats, ['markdown']);
    });

    it('falls back to config dir and formats', () => {
      const { dir, formats } = resolveOutput(undefined, {}, { output: { dir: './cfg', formats: ['html', 'markdown'] } });
      assert.equal(dir, './cfg');
      assert.deepEqual(formats, ['html', 'markdown']);
    });

    it('returns null formats when nothing selected (caller keeps its default)', () => {
      const { dir, formats } = resolveOutput(undefined, {}, {});
      assert.equal(dir, null);
      assert.equal(formats, null);
    });
  });

  describe('readProjects', () => {
    it('returns [] when no projects configured', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({ baseline: 'v1.0.0' }));
      assert.deepEqual(await readProjects(dir, '.dcr.json'), []);
    });

    it('returns valid projects and skips invalid entries', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({
        projects: [
          { name: 'a', path: '../a' },
          { name: 'b', repo: 'https://github.com/x/b.git' },
          { path: '../c' },              // missing name -> skipped
          { name: 'd' },                 // missing path/repo -> skipped
        ],
      }));
      const projects = await readProjects(dir, '.dcr.json');
      assert.deepEqual(projects.map((p) => p.name), ['a', 'b']);
    });
  });

  describe('readCompareOptions', () => {
    it('maps the compare block to compareReports options', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({
        compare: { filter: ['react-native*'], only: ['@company/*'], ignoreDev: true, includeNested: true },
      }));
      const opts = await readCompareOptions(dir, '.dcr.json');
      assert.deepEqual(opts, {
        excludePatterns: ['react-native*'],
        includePatterns: ['@company/*'],
        ignoreDev: true,
        includeNested: true,
      });
    });

    it('defaults to empty options when no compare block', async () => {
      await writeFile(join(dir, '.dcr.json'), JSON.stringify({}));
      const opts = await readCompareOptions(dir, '.dcr.json');
      assert.deepEqual(opts, { excludePatterns: [], includePatterns: [], ignoreDev: false, includeNested: false });
    });
  });
});
