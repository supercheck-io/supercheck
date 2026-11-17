import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Dashboard-only vars and secrets; siteverify itself is mocked in every test.
        bindings: {
          TURNSTILE_SECRET: "test-secret",
          IP_HASH_KEY: "test-key",
          CHECKS_ENABLED: "true",
          TOOLS: "uptime,api,https,headers,agents,dns,social,domain",
          BLOCKED_HOSTS: "",
        },
      },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/test-helpers.ts", "src/**/*.d.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
