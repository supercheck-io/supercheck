/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

// The Private Agent worker ships its own copy of the provider modules because it
// is a separate package. Edit the app files, then run `npm run sync:sre-providers` in app/.
const FILES = ["provider-core", "jaeger", "newrelic", "splunk", "gcp-monitoring", "azure-monitor"];

describe("worker provider copies", () => {
  it.each(FILES)("%s.ts matches the worker copy", (name) => {
    const appFile = path.join(__dirname, `${name}.ts`);
    const workerFile = path.join(__dirname, "../../../../../../worker/src/private-agent/providers", `${name}.ts`);
    // Run `npm run sync:sre-providers` in app/ to regenerate the worker copies.
    expect({ file: name, drifted: readFileSync(workerFile, "utf8") !== readFileSync(appFile, "utf8") }).toEqual({ file: name, drifted: false });
  });
});
