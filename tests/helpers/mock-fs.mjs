import { mock } from 'node:test';

/**
 * Create a mock file system for testing
 * @param {Object} fileStructure - Object representing file structure
 * @returns {Object} - Mock fs functions
 */
export const createMockFileSystem = (fileStructure = {}) => {
  const mockReadFile = mock.fn();
  const mockWriteFile = mock.fn();
  const mockMkdir = mock.fn();
  const mockRm = mock.fn();

  // Configure readFile mock
  mockReadFile.mock.mockImplementation(async (path, encoding) => {
    const content = fileStructure[path];
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return typeof content === 'string' ? content : JSON.stringify(content);
  });

  // Configure other mocks with simple implementations
  mockWriteFile.mock.mockImplementation(async () => {});
  mockMkdir.mock.mockImplementation(async () => {});
  mockRm.mock.mockImplementation(async () => {});

  return {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    rm: mockRm
  };
};

/**
 * Create mock package.json content
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @param {Object} options - Additional options
 * @returns {Object} - Package.json object
 */
export const createMockPackageJson = (name, version, options = {}) => {
  return {
    name,
    version,
    repository: options.repository || null,
    dependencies: options.dependencies || {},
    ...options
  };
};

/**
 * Create mock package-lock.json content
 * @param {Object} packages - Packages to include
 * @param {number} lockfileVersion - Lockfile version
 * @returns {Object} - Package-lock.json object
 */
export const createMockPackageLock = (packages = {}, lockfileVersion = 2) => {
  if (lockfileVersion >= 2) {
    const lockPackages = { '': { name: 'root', version: '1.0.0' } };
    
    Object.entries(packages).forEach(([name, info]) => {
      lockPackages[`node_modules/${name}`] = {
        version: info.version,
        resolved: `https://registry.npmjs.org/${name}/-/${name}-${info.version}.tgz`,
        integrity: 'sha512-mock-integrity'
      };
    });

    return {
      name: 'root',
      version: '1.0.0',
      lockfileVersion,
      packages: lockPackages
    };
  } else {
    const dependencies = {};
    
    Object.entries(packages).forEach(([name, info]) => {
      dependencies[name] = {
        version: info.version,
        resolved: `https://registry.npmjs.org/${name}/-/${name}-${info.version}.tgz`,
        integrity: 'sha512-mock-integrity'
      };
    });

    return {
      name: 'root',
      version: '1.0.0',
      lockfileVersion,
      dependencies
    };
  }
};
