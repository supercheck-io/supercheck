#!/usr/bin/env node
// Copies the SRE observability provider modules from the app into the Private
// Agent worker, formatted with the worker's Prettier config. The app files are
// the source of truth; worker-copy.spec.ts fails when the copies drift.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(root, "app/src/lib/sre/connectors/providers");
const target = path.join(root, "worker/src/private-agent/providers");
const prettier = path.join(root, "worker/node_modules/.bin/prettier");
const files = [
  "provider-core",
  "jaeger",
  "newrelic",
  "splunk",
  "gcp-monitoring",
  "azure-monitor",
];

if (!existsSync(prettier)) {
  console.error("Run `npm ci` in worker/ first (Prettier is required).");
  process.exit(1);
}

for (const name of files) {
  const from = path.join(source, `${name}.ts`);
  execFileSync(
    prettier,
    ["--config", path.join(root, "worker/.prettierrc"), "--write", from],
    { stdio: "ignore" },
  );
  copyFileSync(from, path.join(target, `${name}.ts`));
}
console.log(`Synced ${files.length} provider modules to the worker.`);
