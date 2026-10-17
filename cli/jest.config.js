/**
 * Jest configuration for @supercheck/cli
 *
 * Uses ts-jest with ESM support to match the CLI's native ESM configuration.
 * Consistent with the supercheck/app jest setup.
 */

/** @type {import('jest').Config} */
const config = {
  // Use ts-jest for TypeScript support with ESM
  preset: 'ts-jest/presets/default-esm',

  // Node environment for CLI testing
  testEnvironment: 'node',

  // ESM support
  extensionsToTreatAsEsm: ['.ts'],

  // Module resolution
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Transform settings for ESM
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,

      },
    ],
  },

  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/*.test.ts',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/bin/**',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 52,
      lines: 50,
      statements: 50,
    },
    // Critical reconciliation logic (create/update/delete planning and
    // masked-secret handling) is ratcheted independently. Keep these floors at
    // or below measured coverage and raise them as tests are added.
    './src/utils/reconcile.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    // Command surfaces now covered directly in-process instead of only through
    // spawned CLI runs, where coverage instrumentation cannot see them.
    './src/commands/alerts.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/commands/audit.ts': {
      branches: 82,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/commands/config.ts': {
      branches: 45,
      functions: 95,
      lines: 85,
      statements: 85,
    },
    './src/commands/health.ts': {
      branches: 50,
      functions: 95,
      lines: 75,
      statements: 75,
    },
    // Provider updates must never round-trip masked credentials.
    './src/commands/notifications.ts': {
      branches: 80,
      functions: 80,
      lines: 88,
      statements: 88,
    },
    './src/commands/runs.ts': {
      branches: 48,
      functions: 58,
      lines: 70,
      statements: 70,
    },
    './src/commands/skills.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    './src/commands/tags.ts': {
      branches: 90,
      functions: 60,
      lines: 75,
      statements: 75,
    },
    './src/commands/validate.ts': {
      branches: 70,
      functions: 72,
      lines: 95,
      statements: 95,
    },
    './src/commands/variables.ts': {
      branches: 90,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },

  // Timeout for async tests
  testTimeout: 10000,

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};

export default config;
