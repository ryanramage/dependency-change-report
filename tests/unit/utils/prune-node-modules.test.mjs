import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pruneNodeModulesToPackageJson } from '../../../lib/utils/prune-node-modules.mjs';

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

describe('pruneNodeModulesToPackageJson', () => {
  let dir;
  let nm;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dcr-prune-test-'));
    nm = join(dir, 'node_modules');
    // top-level package with source + a nested node_modules
    await mkdir(join(nm, 'foo', 'node_modules', 'bar'), { recursive: true });
    await writeFile(join(nm, 'foo', 'package.json'), '{"name":"foo"}');
    await writeFile(join(nm, 'foo', 'index.js'), 'module.exports=1');
    await writeFile(join(nm, 'foo', 'node_modules', 'bar', 'package.json'), '{"name":"bar"}');
    // scoped package with source
    await mkdir(join(nm, '@scope', 'pkg', 'lib'), { recursive: true });
    await writeFile(join(nm, '@scope', 'pkg', 'package.json'), '{"name":"@scope/pkg"}');
    await writeFile(join(nm, '@scope', 'pkg', 'lib', 'x.js'), 'x');
    // npm cruft
    await mkdir(join(nm, '.bin'), { recursive: true });
    await writeFile(join(nm, '.bin', 'tool'), '#!/bin/sh');
    await writeFile(join(nm, '.package-lock.json'), '{}');

    await pruneNodeModulesToPackageJson(nm);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps each top-level package.json', async () => {
    assert.equal(await exists(join(nm, 'foo', 'package.json')), true);
    assert.equal(await exists(join(nm, '@scope', 'pkg', 'package.json')), true);
  });

  it('deletes source files and nested node_modules', async () => {
    assert.equal(await exists(join(nm, 'foo', 'index.js')), false);
    assert.equal(await exists(join(nm, 'foo', 'node_modules')), false);
    assert.equal(await exists(join(nm, '@scope', 'pkg', 'lib')), false);
  });

  it('removes npm cruft (.bin, .package-lock.json)', async () => {
    assert.equal(await exists(join(nm, '.bin')), false);
    assert.equal(await exists(join(nm, '.package-lock.json')), false);
  });

  it('is a no-op when the directory does not exist', async () => {
    await pruneNodeModulesToPackageJson(join(dir, 'nope', 'node_modules'));
  });
});
