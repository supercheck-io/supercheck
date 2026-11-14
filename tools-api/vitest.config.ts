import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Tests run with Cloudflare's always-pass Turnstile test secret.
        bindings: { TURNSTILE_SECRET: "1x0000000000000000000000000000000AA", IP_HASH_KEY: "test-key", TURNSTILE_TEST_MODE: "true" },
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
