/** @jest-environment node */
const mockCan = jest.fn();
const mockFindConnector = jest.fn();
const mockUpdateWhere = jest.fn();
const mockQueue = jest.fn();
const mockWait = jest.fn();

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
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCan(...a),
}));
jest.mock("@/utils/db", () => ({
  db: {
    query: { externalConnectors: { findFirst: (...a: unknown[]) => mockFindConnector(...a) } },
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: (values: unknown) => ({ where: (...a: unknown[]) => mockUpdateWhere(values, ...a) }) }),
  },
}));
jest.mock("@/lib/sre/connectors", () => ({
  ...jest.requireActual("@/lib/sre/connectors"),
  assertEndpointAllowedForExecution: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreConnectorValidationRateLimit: jest.fn(async () => ({ allowed: true, remaining: 1 })),
}));
jest.mock("@/lib/sre/mcp-private-agent-job", () => ({
  ...jest.requireActual("@/lib/sre/mcp-private-agent-job"),
  queueMcpPrivateAgentJob: (...a: unknown[]) => mockQueue(...a),
  loadMcpJob: () => jest.fn(),
}));
jest.mock("@/lib/sre/private-agent-job-waiter", () => ({
  waitForPrivateAgentConnectorJob: (...a: unknown[]) => mockWait(...a),
}));

import {
  discoverSreMcpTools,
  getSreMcpToolState,
  saveSreMcpToolAllowlist,
} from "./sre-mcp-connectors";

const id = "018f0000-0000-7000-8000-000000000004";
const schema = { type: "object", properties: { q: { type: "string" } }, additionalProperties: false };
const connector = (overrides: Record<string, unknown> = {}) => ({
  id,
  type: "mcp",
  status: "configured",
  privateAgentId: "018f0000-0000-7000-8000-000000000009",
  config: { endpointUrl: "https://mcp.internal/mcp" },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockFindConnector.mockResolvedValue(connector());
});

describe("MCP connector actions", () => {
  it("requires configure permission and a Private Agent MCP connector", async () => {
    mockCan.mockReturnValue(false);
    expect(await getSreMcpToolState({ id })).toMatchObject({ success: false });
    mockCan.mockReturnValue(true);

    mockFindConnector.mockResolvedValue(connector({ privateAgentId: null }));
    const direct = await discoverSreMcpTools({ id });
    expect(direct).toMatchObject({ success: false, error: expect.stringContaining("Private Agent") });
    expect(mockQueue).not.toHaveBeenCalled();

    mockFindConnector.mockResolvedValue(connector({ type: "prometheus" }));
    expect(await discoverSreMcpTools({ id })).toMatchObject({ success: false });
    expect(await discoverSreMcpTools({ id: "nope" })).toMatchObject({ success: false });
  });

  it("discovers tools through a Private Agent job and stores them without allowlisting any", async () => {
    mockQueue.mockResolvedValue({ jobId: "job-1", privateAgentId: "agent-1", route: {} });
    mockWait.mockResolvedValue({
      state: "completed",
      job: {
        resultSummary: {
          evidence: [
            {
              id: "t1",
              sourceUri: "https://mcp.internal/mcp#tool=search",
              title: "MCP tool: search",
              summary: JSON.stringify({ d: "Search", s: schema, a: { readOnlyHint: true } }),
              evidenceType: "artifact",
              observedAt: "2026-10-27T10:00:00.000Z",
              resultHash: "a".repeat(64),
            },
          ],
        },
      },
    });
    const result = await discoverSreMcpTools({ id });
    expect(mockQueue.mock.calls[0][0]).toMatchObject({
      serviceId: "mcp-discovery",
      operation: { kind: "discover" },
      authorizedBy: "user",
    });
    expect(result).toMatchObject({
      success: true,
      state: { discovered: [{ name: "search", readOnlyHint: true }], allowlist: [] },
    });
    expect(mockUpdateWhere.mock.calls[0][0]).toMatchObject({ status: "valid" });
  });

  it("returns a safe error when discovery fails or is still queued", async () => {
    mockQueue.mockResolvedValue({ jobId: "job-1", privateAgentId: "agent-1", route: {} });
    mockWait.mockResolvedValue({ state: "failed", job: { errorCode: "mcp_http_500 secret-detail" } });
    const failed = await discoverSreMcpTools({ id });
    expect(failed).toMatchObject({ success: false });
    expect(JSON.stringify(failed)).not.toContain("secret-detail");
    mockWait.mockResolvedValue({ state: "pending", job: {} });
    expect(await discoverSreMcpTools({ id })).toMatchObject({ success: false });
  });

  it("saves only discovered, supported tools", async () => {
    mockFindConnector.mockResolvedValue(
      connector({
        config: {
          endpointUrl: "https://mcp.internal/mcp",
          mcp: {
            discovered: [
              { name: "search", description: "Search", inputSchema: schema, unsupportedReason: null },
              { name: "wild", description: "", inputSchema: null, unsupportedReason: "unsupported keyword oneOf" },
            ],
          },
        },
      }),
    );
    expect(await saveSreMcpToolAllowlist({ id, tools: [{ name: "ghost" }] })).toMatchObject({ success: false });
    expect(await saveSreMcpToolAllowlist({ id, tools: [{ name: "wild" }] })).toMatchObject({ success: false });
    expect(mockUpdateWhere).not.toHaveBeenCalled();

    const ok = await saveSreMcpToolAllowlist({ id, tools: [{ name: "search" }] });
    expect(ok).toMatchObject({ success: true, state: { allowlist: [{ name: "search" }] } });
    const saved = mockUpdateWhere.mock.calls[0][0] as { config: { endpointUrl: string; mcp: { allowlist: unknown[] } } };
    expect(saved.config.endpointUrl).toBe("https://mcp.internal/mcp");
    expect(saved.config.mcp.allowlist).toHaveLength(1);
  });
});
