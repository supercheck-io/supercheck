/** @jest-environment node */
const mockFindConnector = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({
    userId: "u1",
    organizationId: "o1",
    project: { id: "p1", userRole: "org_owner" },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/utils/db", () => ({
  db: {
    query: { externalConnectors: { findFirst: (...a: unknown[]) => mockFindConnector(...a) } },
    transaction: jest.fn(),
  },
}));

import { createSreConnector, searchSreConnectorEvidence } from "./sre-connectors";

const { db } = jest.requireMock("@/utils/db");
const base = {
  name: "Internal MCP",
  type: "mcp" as const,
  endpointUrl: "https://mcp.internal/mcp",
  serviceIds: [],
  riskLevel: "low" as const,
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
};

describe("MCP connector creation and search guards", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects direct execution for MCP connectors server-side", async () => {
    const result = await createSreConnector({ ...base, privateAgentId: null });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Private Agent") });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("requires an endpoint URL", async () => {
    const result = await createSreConnector({
      ...base,
      endpointUrl: "",
      privateAgentId: "018f0000-0000-7000-8000-000000000009",
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("endpoint") });
  });

  it("rejects reserved credential header names", async () => {
    const result = await createSreConnector({
      ...base,
      privateAgentId: "018f0000-0000-7000-8000-000000000009",
      credential: { credentialType: "api_key", value: { secret: "x", headerName: "Host" } },
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("reserved") });
  });

  it("does not expose MCP connectors to free-form evidence search", async () => {
    mockFindConnector.mockResolvedValue({
      id: "018f0000-0000-7000-8000-000000000004",
      type: "mcp",
      status: "valid",
      privateAgentId: "018f0000-0000-7000-8000-000000000009",
    });
    const result = await searchSreConnectorEvidence({
      id: "018f0000-0000-7000-8000-000000000004",
      serviceId: "018f0000-0000-7000-8000-000000000003",
      query: "anything",
      timeWindowMinutes: 60,
      filters: {},
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("not searchable") });
  });
});
