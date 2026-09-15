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
