import { defineConfig, devices } from "@playwright/test";

// Runs against the static export in docs/out. The checks API and Turnstile are mocked per test.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "node e2e/serve.mjs", url: "http://127.0.0.1:4173/tools", reuseExistingServer: !process.env.CI, cwd: ".." },
});
