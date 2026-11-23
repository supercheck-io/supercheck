/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

import { MCP_FORBIDDEN_HEADER_NAMES } from "./mcp";

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

// Security lists the worker keeps in its own modules: the app validates config against its copy,
// the agent enforces its own, so a drift either accepts config the agent rejects or lets one through.
describe("worker security list parity", () => {
  const workerSource = (file: string) =>
    readFileSync(path.join(__dirname, "../../../../../../worker/src/private-agent", file), "utf8");

  it("MCP forbidden header names match the worker", () => {
    const block = workerSource("mcp-client.ts").match(/FORBIDDEN_HEADER_NAMES = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
    const workerNames = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(workerNames.length).toBeGreaterThan(0);
    expect([...workerNames].sort()).toEqual([...MCP_FORBIDDEN_HEADER_NAMES].sort());
  });

  it("the worker blocks the local-use NAT64 prefix the app blocks", () => {
    expect(readFileSync(path.join(__dirname, "../endpoint-policy.ts"), "utf8")).toContain('"64:ff9b:1::/48"');
    expect(workerSource("private-agent-endpoint.ts")).toContain("['64:ff9b:1::', 48]");
  });

  it("the worker bounds DNS lookups like the app", () => {
    expect(workerSource("private-agent-endpoint.ts")).toMatch(/await lookupBounded\(hostname, init\.signal\)/);
  });
});
