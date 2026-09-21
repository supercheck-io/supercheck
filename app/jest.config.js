const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  testPathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
    "<rootDir>/src/db/",
    "<rootDir>/e2e/",
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
      branches: 3,
      functions: 3,
      lines: 4,
      statements: 4,
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
