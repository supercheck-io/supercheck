module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  rootDir: 'src',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!**/node_modules/**'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 47,
      lines: 55,
      statements: 55,
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
    './src/common/services/cancellation.service.ts': {
      branches: 95,
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
    // Execution report parsing and the variable/secret runtime helpers.
    './src/execution/services/execution.service.ts': {
      branches: 22,
      functions: 40,
      lines: 28,
      statements: 28,
    },
    './src/execution/services/queue-status.service.ts': {
      branches: 90,
      functions: 55,
      lines: 85,
      statements: 85,
    },
    // Operator-facing structured logging contract.
    './src/logger/logger.service.ts': {
      branches: 80,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    // Queue health alerting: thresholds, de-duplication and notification delivery.
    './src/queue-alerting/queue-alerting.service.ts': {
      branches: 75,
      functions: 78,
      lines: 85,
      statements: 85,
    },
    // Monitor execution: pass/fail evaluation, TCP/TLS checks and SSL handling.
    './src/monitor/monitor.service.ts': {
      branches: 28,
      functions: 58,
      lines: 45,
      statements: 45,
    },
  },
  testTimeout: 10000,
  // Transform ESM modules that Jest can't parse by default
  transformIgnorePatterns: [
    'node_modules/(?!(execa|strip-final-newline|npm-run-path|path-key|onetime|mimic-fn|human-signals|is-stream|get-stream|signal-exit|@kubernetes/client-node|tar|minipass|minizlib|mkdirp|yallist)/)',
  ],
};
