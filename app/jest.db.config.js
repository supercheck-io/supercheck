/**
 * Jest configuration for app database integration tests.
 *
 * These specs need a real, disposable PostgreSQL instance: they run migrations,
 * seeds and queries that a mocked `postgres` client cannot prove. They are kept
 * out of the default unit run (see the `\.db\.spec\.ts$` ignore pattern in
 * jest.config.js) so `npm test` stays hermetic, and run explicitly with:
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 *
 * The suite creates and drops its own throwaway database, so the target URL may
 * point at any maintenance database the credentials can create databases in.
 */
const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

const dbJestConfig = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.db.spec.ts"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/", "<rootDir>/e2e/"],
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // Migrations and seed verification are I/O bound and spawn a child process.
  testTimeout: 120_000,
  maxWorkers: 1,
};

module.exports = async () => createJestConfig(dbJestConfig)();
