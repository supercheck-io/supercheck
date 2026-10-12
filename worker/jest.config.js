module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!**/node_modules/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 40,
      lines: 50,
      statements: 50,
    },
    // Security- and reliability-critical modules are ratcheted independently
    // from the broad baseline. Keep these floors at or below measured coverage
    // and raise them as tests are added; a regression now fails CI.
    './src/common/errors/standardized-error-handler.ts': {
      branches: 90,
      functions: 95,
      lines: 92,
      statements: 92,
    },
    './src/common/security/secret-crypto.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/common/utils/retry.util.ts': {
      branches: 85,
      functions: 70,
      lines: 95,
      statements: 95,
    },
    './src/common/validation/http-validators.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/common/validation/network-validators.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
  testTimeout: 10000,
  // Transform ESM modules that Jest can't parse by default
  transformIgnorePatterns: [
    'node_modules/(?!(execa|strip-final-newline|npm-run-path|path-key|onetime|mimic-fn|human-signals|is-stream|get-stream|signal-exit|@kubernetes/client-node|tar|minipass|minizlib|mkdirp|yallist)/)',
  ],
};
