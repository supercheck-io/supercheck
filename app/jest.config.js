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
      branches: 22,
      functions: 27,
      lines: 28,
      statements: 28,
    },
    // Critical paid-service paths are ratcheted independently from the broad
    // application baseline. Keep these floors at or below measured coverage
    // and raise them as tests are added; a regression now fails CI.
    "./src/actions/create-job.ts": {
      branches: 85,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    "./src/actions/delete-test.ts": {
      branches: 78,
      functions: 95,
      lines: 90,
      statements: 90,
    },
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
    // The MCP sign-in server is security-sensitive and its guards live in files that real-stack scripts
    // also exercise; these floors keep the unit tests honest on their own. Raise them as tests are added.
    "./src/lib/mcp/auth-plugins.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/lib/mcp/auth-api.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/lib/mcp/connections.ts": {
      branches: 85,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/lib/mcp/connect-project.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/lib/mcp/client-metadata.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 92,
    },
    "./src/lib/mcp/config.ts": {
      branches: 80,
      functions: 95,
      lines: 98,
      statements: 90,
    },
    "./src/lib/mcp/discovery.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/lib/mcp/http-policy.ts": {
      branches: 90,
      functions: 80,
      lines: 98,
      statements: 92,
    },
    "./src/lib/mcp/http.ts": {
      branches: 85,
      functions: 95,
      lines: 98,
      statements: 90,
    },
    "./src/lib/mcp/redirect.ts": {
      branches: 90,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/app/api/oauth/mcp/consent/route.ts": {
      branches: 85,
      functions: 95,
      lines: 95,
      statements: 92,
    },
    "./src/app/api/oauth/mcp/connections/route.ts": {
      branches: 85,
      functions: 95,
      lines: 98,
      statements: 90,
    },
    "./src/app/api/oauth/mcp/connections/[id]/route.ts": {
      branches: 85,
      functions: 95,
      lines: 98,
      statements: 92,
    },
    "./src/components/connected-apps/connected-apps.tsx": {
      branches: 80,
      functions: 95,
      lines: 98,
      statements: 95,
    },
    "./src/app/(oauth)/oauth/consent/page.tsx": {
      branches: 70,
      functions: 75,
      lines: 92,
      statements: 88,
    },
    "./src/app/(oauth)/oauth/consent/mcp-consent.tsx": {
      branches: 75,
      functions: 70,
      lines: 98,
      statements: 90,
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
