import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PRIVATE_AGENT_CONNECTOR_TYPES } from "@/lib/sre/connectors/connector-capabilities";
import { agentSupportsConnectorType, knownConnectorTypes, reportedConnectorTypes, withReportedConnectorTypes } from "./agent-registry";

describe("agent connector types", () => {
  it("treats an agent that reports nothing as a legacy agent", () => {
    expect(agentSupportsConnectorType({ metadata: {} }, "prometheus")).toBe(true);
    expect(agentSupportsConnectorType({ metadata: null }, "mcp")).toBe(false);
    expect(reportedConnectorTypes({ sreConnectorTypes: "jira" })).toBeNull();
    expect(reportedConnectorTypes({ sreConnectorTypes: ["jira", 1] })).toBeNull();
  });

  it("uses the reported list when there is one", () => {
    expect(agentSupportsConnectorType({ metadata: { sreConnectorTypes: ["mcp"] } }, "mcp")).toBe(true);
    expect(agentSupportsConnectorType({ metadata: { sreConnectorTypes: ["mcp"] } }, "prometheus")).toBe(false);
  });

  it("stores or clears the list without touching other metadata", () => {
    expect(withReportedConnectorTypes({ registrationTokenExpiresAt: "x" }, ["jira"])).toEqual({ registrationTokenExpiresAt: "x", sreConnectorTypes: ["jira"] });
    expect(withReportedConnectorTypes({ registrationTokenExpiresAt: "x", sreConnectorTypes: ["jira"] }, undefined)).toEqual({ registrationTokenExpiresAt: "x" });
    expect(withReportedConnectorTypes(null, undefined)).toEqual({});
  });

  it("stores only connector types the app can route", () => {
    expect(knownConnectorTypes(["jira", "made_up", "x".repeat(50)])).toEqual(["jira"]);
    expect(knownConnectorTypes(undefined)).toBeUndefined();
  });

  it("keeps the worker's supported list in step with the app's Private Agent types", () => {
    const worker = readFileSync(join(__dirname, "../../../../worker/src/private-agent/private-agent-runner.ts"), "utf8");
    const block = worker.match(/SUPPORTED_SRE_CONNECTOR_TYPES = \[([^\]]*)\]/)?.[1] ?? "";
    const workerTypes = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect([...workerTypes].sort()).toEqual([...PRIVATE_AGENT_CONNECTOR_TYPES].sort());
  });
});
