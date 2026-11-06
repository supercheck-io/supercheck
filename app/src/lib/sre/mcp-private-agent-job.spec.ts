/** @jest-environment node */

const mockValues = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: { privateAgents: { findFirst: jest.fn() }, privateAgentJobs: { findFirst: jest.fn() } },
    insert: jest.fn(() => ({
      values: (v: unknown) => {
        mockValues(v);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: "job-1" }] }) };
      },
    })),
  },
}));
jest.mock("@/lib/sre/connectors/mcp-endpoint-secret", () => ({
  resolveMcpEndpointUrl: jest.fn(async () => "https://mcp.example/mcp?key=SECRET"),
}));
jest.mock("@/lib/sre/private-agent-job-cancel", () => ({ joinPrivateAgentJob: jest.fn() }));
jest.mock("@/lib/private-agents/job-router", () => ({
  routeSreConnectorQuery: jest.fn((req: { connector: { endpointUrl: string } }) => ({
    routed: true,
    jobClass: "sre_connector_query",
    privateAgentId: "a",
    idempotencyKey: "k",
    jobSpecHash: "h",
    jobSpec: { endpointUrl: req.connector.endpointUrl },
  })),
}));

import { joinPrivateAgentJob } from "@/lib/sre/private-agent-job-cancel";
import { queueMcpPrivateAgentJob } from "./mcp-private-agent-job";

const { db } = jest.requireMock("@/utils/db") as {
  db: { insert: jest.Mock; query: { privateAgents: { findFirst: jest.Mock }; privateAgentJobs: { findFirst: jest.Mock } } };
};

const input = {
  organizationId: "o",
  projectId: "p",
  connector: { id: "c", type: "mcp", privateAgentId: "a", config: {}, outputLimits: {} } as never,
  scopedServiceIds: [],
  serviceId: "s",
  query: "q",
  operation: { kind: "discover" } as const,
  budget: { maxRows: 1, maxBytes: 1, maxSeconds: 1 },
  authorizedBy: "user" as const,
  userId: null,
  policyDecision: {},
};

it("requeues the conflicting row (cancelled as abandoned) instead of leaving a retry dead", async () => {
  db.query.privateAgents.findFirst.mockResolvedValue({ id: "a" });
  db.insert.mockReturnValueOnce({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) });
  db.query.privateAgentJobs.findFirst.mockResolvedValue({ id: "old-job" });
  const result = await queueMcpPrivateAgentJob(input);
  expect(result).toMatchObject({ jobId: "old-job", inserted: false });
  expect(joinPrivateAgentJob).toHaveBeenCalledWith({ jobId: "old-job", organizationId: "o", projectId: "p" });
});

it("persists only the query-redacted MCP endpoint in job_spec", async () => {
  db.query.privateAgents.findFirst.mockResolvedValue({ id: "a" });
  await queueMcpPrivateAgentJob({
    organizationId: "o",
    projectId: "p",
    connector: { id: "c", type: "mcp", privateAgentId: "a", config: {}, outputLimits: {} } as never,
    scopedServiceIds: [],
    serviceId: "s",
    query: "q",
    operation: { kind: "discover" },
    budget: { maxRows: 1, maxBytes: 1, maxSeconds: 1 },
    authorizedBy: "user",
    userId: null,
    policyDecision: {},
  });
  const stored = JSON.stringify(mockValues.mock.calls[0][0]);
  expect(stored).not.toContain("SECRET");
  expect(stored).toContain("https://mcp.example/mcp?…");
});
