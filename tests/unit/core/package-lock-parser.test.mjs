import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractPackagesFromLock, extractFromDependencies } from '../../../lib/core/package-lock-parser.mjs';

describe('package-lock-parser', () => {
  describe('extractPackagesFromLock', () => {
    it('should extract packages from lockfile version 2+ format', () => {
      const lockData = {
        lockfileVersion: 2,
        packages: {
          '': { name: 'root-package', version: '1.0.0' },
          'node_modules/package-a': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/package-a/-/package-a-1.0.0.tgz',
            integrity: 'sha512-...'
          },
          'node_modules/package-b': {
            version: '2.0.0',
            resolved: 'https://registry.npmjs.org/package-b/-/package-b-2.0.0.tgz',
            integrity: 'sha512-...'
          }
        }
      };

      const result = extractPackagesFromLock(lockData);

      assert.strictEqual(Object.keys(result).length, 2);
      assert.strictEqual(result['package-a'].version, '1.0.0');
      assert.strictEqual(result['package-b'].version, '2.0.0');
      assert.strictEqual(result['package-a'].resolved, 'https://registry.npmjs.org/package-a/-/package-a-1.0.0.tgz');
    });

    it('should extract packages from lockfile version 1 format', () => {
      const lockData = {
        lockfileVersion: 1,
        dependencies: {
          'package-a': {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/package-a/-/package-a-1.0.0.tgz',
            integrity: 'sha512-...'
          },
          'package-b': {
            version: '2.0.0',
            resolved: 'https://registry.npmjs.org/package-b/-/package-b-2.0.0.tgz',
            integrity: 'sha512-...',
            dependencies: {
              'nested-package': {
                version: '1.5.0',
                resolved: 'https://registry.npmjs.org/nested-package/-/nested-package-1.5.0.tgz'
              }
            }
          }
        }
      };

      const result = extractPackagesFromLock(lockData);

      assert.strictEqual(Object.keys(result).length, 3);
      assert.strictEqual(result['package-a'].version, '1.0.0');
      assert.strictEqual(result['package-b'].version, '2.0.0');
      assert.strictEqual(result['nested-package'].version, '1.5.0');
    });

    it('should handle empty lock data', () => {
      const result = extractPackagesFromLock({});
      assert.strictEqual(Object.keys(result).length, 0);
    });
  });

  describe('extractFromDependencies', () => {
    it('should recursively extract nested dependencies', () => {
      const dependencies = {
        'package-a': {
          version: '1.0.0',
          dependencies: {
            'nested-a': {
              version: '2.0.0',
              dependencies: {
                'deeply-nested': {
                  version: '3.0.0'
                }
              }
            }
          }
        }
      };

      const packages = {};
      extractFromDependencies(dependencies, packages);

      assert.strictEqual(Object.keys(packages).length, 3);
      assert.strictEqual(packages['package-a'].version, '1.0.0');
      assert.strictEqual(packages['nested-a'].version, '2.0.0');
      assert.strictEqual(packages['deeply-nested'].version, '3.0.0');
    });
  });
});
