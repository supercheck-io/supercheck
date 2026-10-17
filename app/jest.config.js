const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  // Explicit discovery: only *.spec.* files are tests. The default pattern also
  // matches `src/db/schema/test.ts` (the schema module for the `tests` table),
  // which is why this directory used to be ignored wholesale — that hid any real
  // spec placed in src/db alongside it.
  testMatch: [
    "<rootDir>/**/*.spec.ts",
    "<rootDir>/**/*.spec.tsx",
    "<rootDir>/**/*.spec.js",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
    "<rootDir>/e2e/",
    // Database integration specs need a disposable PostgreSQL instance and run
    // through `npm run test:db` (jest.db.config.js), not the hermetic unit run.
    "\\.db\\.spec\\.ts$",
  ],
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // The schema-contract test loads worker source intentionally. In the app
    // CI job only this package's dependencies are installed, so force the
    // worker's Drizzle imports to resolve to the matching app dependency
    // instead of walking from ../worker for a node_modules directory.
    "^drizzle-orm$": "<rootDir>/node_modules/drizzle-orm/index.cjs",
    "^drizzle-orm/pg-core$": "<rootDir>/node_modules/drizzle-orm/pg-core/index.cjs",
    "^drizzle-zod$": "<rootDir>/node_modules/drizzle-zod/index.cjs",
  },

  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/node_modules/**",
    "!src/**/*.spec.{ts,tsx}",
  ],
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 25,
      lines: 25,
      statements: 25,
    },
    // Critical paid-service paths are ratcheted independently from the broad
    // application baseline. Keep these floors at or below measured coverage
    // and raise them as tests are added; a regression now fails CI.
    "./src/components/subscription-guard.tsx": {
      branches: 70,
      functions: 85,
      lines: 85,
      statements: 80,
    },
    "./src/lib/middleware/plan-enforcement.ts": {
      branches: 65,
      functions: 85,
      lines: 83,
      statements: 83,
    },
    "./src/lib/services/subscription-service.ts": {
      branches: 83,
      functions: 88,
      lines: 88,
      statements: 88,
    },
    "./src/lib/webhooks/polar-event-transaction.ts": {
      branches: 90,
      functions: 100,
      lines: 100,
      statements: 95,
    },
    "./src/lib/rbac/client-permissions.ts": {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
    "./src/lib/playwright-validator.ts": {
      branches: 85,
      functions: 95,
      lines: 93,
      statements: 93,
    },
    "./src/lib/html-report-parser.ts": {
      branches: 65,
      functions: 80,
      lines: 82,
      statements: 80,
    },
  },
  testTimeout: 10000,
};

// Export async config to allow override of transformIgnorePatterns
// for better-auth ESM-only modules in v1.4.x
module.exports = async () => {
  const jestConfig = await createJestConfig(customJestConfig)();
  // Transform ESM modules from better-auth, @better-auth, and their ESM deps
  jestConfig.transformIgnorePatterns = [
    "/node_modules/(?!(better-auth|@better-auth|rou3|better-call|@noble|jose|nanostores)/)",
    "^.+\\.module\\.(css|sass|scss)$",
  ];
  return jestConfig;
};
