/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

// The worker renders alert emails itself from byte-identical copies of these templates.
// Edit the app files, then run `node app/scripts/sync-email-templates.mjs`.
const FILES = ["base-layout.tsx", "monitor-alert.tsx"];

describe("worker email template copies", () => {
  it.each(FILES)("%s matches the worker copy", (name) => {
    const appFile = path.join(__dirname, name);
    const workerFile = path.join(__dirname, "../../../worker/src/emails", name);
    expect({ file: name, drifted: readFileSync(workerFile, "utf8") !== readFileSync(appFile, "utf8") }).toEqual({ file: name, drifted: false });
  });
});
