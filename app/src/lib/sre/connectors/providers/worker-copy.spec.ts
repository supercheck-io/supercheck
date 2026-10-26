/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

// The Private Agent worker ships its own copy of the provider modules because it
// is a separate package. Run worker's sync script (see PR notes) when this fails.
const FILES = ["provider-core", "jaeger", "newrelic", "splunk", "gcp-monitoring", "azure-monitor"];

describe("worker provider copies", () => {
  it.each(FILES)("%s.ts matches the worker copy", (name) => {
    const appFile = path.join(__dirname, `${name}.ts`);
    const workerFile = path.join(__dirname, "../../../../../../worker/src/private-agent/providers", `${name}.ts`);
    expect(readFileSync(workerFile, "utf8")).toBe(readFileSync(appFile, "utf8"));
  });
});
