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

  // Timeout for async tests
  testTimeout: 10000,

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,
};

export default config;
