import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDcrConfig, resolveBaseline } from '../../../lib/utils/config.mjs';

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
});
