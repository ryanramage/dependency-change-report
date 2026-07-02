import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { compareDependencies } from '../../../lib/core/dependency-comparer.mjs';

describe('dependency-comparer', () => {
  let oldDeps, newDeps;

  beforeEach(() => {
    oldDeps = {
      'package-a': { version: '1.0.0' },
      'package-b': { version: '2.0.0' },
      'package-c': { version: '1.5.0' }
    };
    
    newDeps = {
      'package-a': { version: '1.1.0' }, // minor upgrade
      'package-b': { version: '3.0.0' }, // major upgrade
      'package-d': { version: '1.0.0' }  // new package
    };
  });

  it('should detect added dependencies', () => {
    const result = compareDependencies(oldDeps, newDeps);
    
    assert.strictEqual(result.added.length, 1);
    assert.strictEqual(result.added[0].name, 'package-d');
    assert.strictEqual(result.added[0].version, '1.0.0');
  });

  it('should detect removed dependencies', () => {
    const result = compareDependencies(oldDeps, newDeps);
    
    assert.strictEqual(result.removed.length, 1);
    assert.strictEqual(result.removed[0].name, 'package-c');
    assert.strictEqual(result.removed[0].version, '1.5.0');
  });

  it('should detect upgraded dependencies with correct change types', () => {
    const result = compareDependencies(oldDeps, newDeps);
    
    assert.strictEqual(result.upgraded.length, 2);
    
    const packageA = result.upgraded.find(dep => dep.name === 'package-a');
    assert.strictEqual(packageA.oldVersion, '1.0.0');
    assert.strictEqual(packageA.newVersion, '1.1.0');
    assert.strictEqual(packageA.changeType, 'minor');
    
    const packageB = result.upgraded.find(dep => dep.name === 'package-b');
    assert.strictEqual(packageB.oldVersion, '2.0.0');
    assert.strictEqual(packageB.newVersion, '3.0.0');
    assert.strictEqual(packageB.changeType, 'major');
  });

  it('should detect namespace changes', () => {
    const oldDepsWithNamespace = {
      'package-name': { version: '1.0.0' }
    };
    
    const newDepsWithNamespace = {
      '@scope/package-name': { version: '1.1.0' }
    };
    
    const result = compareDependencies(oldDepsWithNamespace, newDepsWithNamespace);
    
    assert.strictEqual(result.modified.length, 1);
    assert.strictEqual(result.modified[0].oldName, 'package-name');
    assert.strictEqual(result.modified[0].newName, '@scope/package-name');
    assert.strictEqual(result.modified[0].changeType, 'namespace');
  });

  it('falls back to lockfile versions when the dep tree omits them', () => {
    // npm ls can list a node without a version (deduped/unmet); the added/removed
    // entry should still get a version from packageVersions (the lockfile).
    const oldD = { 'gone': {} };            // removed, no version in tree
    const newD = { 'fresh': {} };           // added, no version in tree
    const packageVersions = {
      'fresh': { newVersion: '2.3.4', changeType: 'added', devDep: false },
      'gone': { oldVersion: '9.8.7', changeType: 'removed', devDep: false },
    };
    const result = compareDependencies(oldD, newD, packageVersions);

    assert.strictEqual(result.added[0].name, 'fresh');
    assert.strictEqual(result.added[0].version, '2.3.4');
    assert.strictEqual(result.removed[0].name, 'gone');
    assert.strictEqual(result.removed[0].version, '9.8.7');
  });

  it('should handle empty dependency objects', () => {
    const result = compareDependencies({}, {});
    
    assert.strictEqual(result.added.length, 0);
    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.upgraded.length, 0);
    assert.strictEqual(result.modified.length, 0);
  });
});
