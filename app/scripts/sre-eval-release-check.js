#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const {
  buildSreEvalReleasePolicy,
  summarizeSreEvalReleasePolicy,
  validateSreEvalReleasePolicy,
} = require("./sre-eval-release-policy");

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

function main() {
  const policy = buildSreEvalReleasePolicy();
  validateSreEvalReleasePolicy(policy);

  console.log(`SRE eval release policy: ${summarizeSreEvalReleasePolicy(policy)}`);
  console.log("Running deterministic SRE eval release gate...");
  run("npm", ["run", "test:sre-eval"]);

  if (policy.live.enabled) {
    console.log(`Running seeded live SRE eval release gate (${policy.live.mode})...`);
    run("npm", ["run", "test:sre-eval:live"]);
  } else {
    console.log(`Skipping seeded live SRE eval release gate (${policy.live.mode}).`);
  }

  if (policy.modelGrade.enabled) {
    console.log(`Running model-graded SRE eval release gate (${policy.modelGrade.mode})...`);
    run("npm", ["run", "test:sre-eval:model"]);
  } else {
    console.log(`Skipping model-graded SRE eval release gate (${policy.modelGrade.mode}).`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
