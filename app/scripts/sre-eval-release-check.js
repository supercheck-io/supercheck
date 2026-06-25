#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requireLiveEvalConfig() {
  const missing = ["SRE_EVAL_BASE_URL", "SRE_EVAL_AUTH_TOKEN", "SRE_EVAL_INCIDENT_IDS"].filter(
    (name) => !process.env[name]?.trim()
  );

  if (missing.length > 0) {
    throw new Error(`Live SRE eval release gate requires: ${missing.join(", ")}`);
  }
}

function main() {
  console.log("Running deterministic SRE eval release gate...");
  run("npm", ["run", "test:sre-eval"]);

  const requireLive = process.env.SRE_EVAL_RELEASE_REQUIRE_LIVE === "true";
  const liveEnabled = process.env.SRE_EVAL_LIVE_ENABLED === "true";

  if (requireLive && !liveEnabled) {
    throw new Error("SRE_EVAL_RELEASE_REQUIRE_LIVE=true requires SRE_EVAL_LIVE_ENABLED=true");
  }

  if (liveEnabled) {
    requireLiveEvalConfig();
    console.log("Running seeded live SRE eval release gate...");
    run("npm", ["run", "test:sre-eval:live"]);
  } else {
    console.log("Skipping seeded live SRE eval release gate because SRE_EVAL_LIVE_ENABLED is not true.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
