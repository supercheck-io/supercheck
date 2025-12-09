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
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
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
  // Transform ESM modules from better-auth and @better-auth (ESM-only in v1.4.x)
  jestConfig.transformIgnorePatterns = [
    "/node_modules/(?!(better-auth|@better-auth)/)",
    "^.+\\.module\\.(css|sass|scss)$",
  ];
  return jestConfig;
};
