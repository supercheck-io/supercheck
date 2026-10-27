#!/usr/bin/env node
// Copies the email templates the worker renders (alert emails) from the app
// into worker/src/emails, byte-for-byte. The app files are the source of truth;
// worker-copy.spec.ts next to the templates fails when the copies drift.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(root, "app/src/emails");
const target = path.join(root, "worker/src/emails");
const files = ["base-layout.tsx", "monitor-alert.tsx"];

mkdirSync(target, { recursive: true });
for (const name of files) {
  copyFileSync(path.join(source, name), path.join(target, name));
}
console.log(`Synced ${files.length} email templates to the worker.`);
