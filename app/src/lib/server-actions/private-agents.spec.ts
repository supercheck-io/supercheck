/** @jest-environment node */
// Permission denials ask whether the organization is pending deletion; these specs run without a database.
jest.mock("@/lib/deletion/org-state", () => {
  const overrides: Record<string, unknown> = {
    isOrgPendingDeletion: async () => false,
    isProjectDeleted: async () => false,
    isProjectOrgPending: async () => false,
    permissionDeniedResponse: async (_org: unknown, message: string) => Response.json({ error: message }, { status: 403 }),
    permissionDeniedResult: async (_org: unknown, message: string) => ({ success: false, error: message, message }),
  };
  return new Proxy({}, { get: (_t, key: string) => (key in overrides ? overrides[key] : jest.requireActual("@/lib/deletion/org-state")[key]) });
});
const mockImpersonated = jest.fn();
const mockCan = jest.fn();
const mockTransaction = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/private-agents/registration-token", () => ({ buildPrivateAgentRegistrationMetadata: jest.fn(() => ({})) }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCan(...a),
  isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a),
}));
const mockFindFirst = jest.fn();
let mockRows: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: {
    transaction: (...a: unknown[]) => mockTransaction(...a),
    query: { privateAgents: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => mockRows }) }) }),
  },
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { disablePrivateAgent, getPrivateAgents, registerPrivateAgent, rotatePrivateAgentToken } from "./private-agents";

beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockImpersonated.mockResolvedValue(false);
});

describe("rotatePrivateAgentToken", () => {
  it("refuses while a super admin is impersonating, before touching the agent", async () => {
    mockImpersonated.mockResolvedValue(true);
    const result = await rotatePrivateAgentToken({ id: "018f0000-0000-7000-8000-000000000001" });
    expect(result.success).toBe(false);
    expect(String((result as { error?: string }).error)).toMatch(/impersonating/);
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("registerPrivateAgent", () => {
  it("refuses while a super admin is impersonating, before creating anything", async () => {
    mockImpersonated.mockResolvedValue(true);
    const result = await registerPrivateAgent({ name: "edge-1", projectScoped: true });
    expect(result.success).toBe(false);
    expect(String((result as { error?: string }).error)).toMatch(/impersonating/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("still enforces the connector permission first", async () => {
    mockCan.mockReturnValue(false);
    const result = await registerPrivateAgent({ name: "edge-1", projectScoped: true });
    expect(String((result as { error?: string }).error)).toMatch(/Insufficient permissions/);
    expect(mockImpersonated).not.toHaveBeenCalled();
  });
});

describe("org-wide Private Agents", () => {
  // Project-level editors hold sre_connector:configure but not organization:update.
  const projectOnly = (resource: string) => resource === "sre_connector";

  it("refuses to register an org-wide agent without org-level permission", async () => {
    mockCan.mockImplementation(projectOnly);
    const result = await registerPrivateAgent({ name: "edge-1", projectScoped: false });
    expect(result.success).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses to rotate an org-wide agent token without org-level permission", async () => {
    mockCan.mockImplementation(projectOnly);
    mockFindFirst.mockResolvedValue({ id: "a1", projectId: null, status: "connected" });
    const result = await rotatePrivateAgentToken({ id: "00000000-0000-4000-8000-000000000001" });
    expect(result.success).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [true, true],
  ])("disable: org-level permission=%s may target org-wide agents=%s", async (orgLevel, includesOrgWide) => {
    mockCan.mockImplementation((resource: string) => resource === "sre_connector" || (orgLevel && resource === "organization"));
    let condition: SQL | undefined;
    mockTransaction.mockImplementation(async (fn) => fn({
      update: () => ({ set: () => ({ where: (c: SQL) => { condition = c; return { returning: async () => [] }; } }) }),
    }));
    await disablePrivateAgent({ id: "00000000-0000-4000-8000-000000000001" });
    const text = new PgDialect().sqlToQuery(condition as SQL).sql;
    expect(/is null/i.test(text)).toBe(includesOrgWide);
  });
});

describe("getPrivateAgents", () => {
  it("reports a connected agent with a stale heartbeat as disconnected", async () => {
    const base = { name: "a", version: "1", agentMode: "sre", supportsSreConnectors: true, region: null, networkLabel: null, lastError: null, projectId: null };
    mockRows = [
      { ...base, id: "stale", status: "connected", lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
      { ...base, id: "fresh", status: "connected", lastHeartbeatAt: new Date() },
    ];
    const result = await getPrivateAgents();
    expect(result.agents.map((a) => [a.id, a.status])).toEqual([["stale", "disconnected"], ["fresh", "connected"]]);
  });
});

describe("Private Agent lifecycle hardening", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  function recordingTx(returning: unknown[]) {
    const sets: Array<Record<string, unknown>> = [];
    const conditions: SQL[] = [];
    const tx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return {
            where: (c: SQL) => {
              conditions.push(c);
              return { returning: async () => returning, then: (r: (v: unknown) => void) => r(undefined) };
            },
          };
        },
      }),
    };
    mockTransaction.mockImplementation(async (fn) => fn(tx));
    return { sets, conditions };
  }

  it("disable drops the registration token and fails the agent's open jobs", async () => {
    const { sets, conditions } = recordingTx([{ id, name: "a", status: "disabled", lastHeartbeatAt: null }]);
    const result = await disablePrivateAgent({ id });
    expect(result.success).toBe(true);
    expect(sets[0]).toMatchObject({ status: "disabled", registrationTokenHash: null });
    expect(sets.at(-1)).toMatchObject({ status: "failed", errorCode: "agent_disabled" });
    const jobSql = new PgDialect().sqlToQuery(conditions.at(-1) as SQL);
    expect(jobSql.params).toEqual(expect.arrayContaining(["queued", "leased", "running"]));
  });

  it("rotate guards the UPDATE on a non-disabled status, clears the heartbeat, and fails when the guard misses", async () => {
    mockFindFirst.mockResolvedValue({ id, projectId: "p1", status: "connected", metadata: {} });
    const { sets, conditions } = recordingTx([]);
    const result = await rotatePrivateAgentToken({ id });
    expect(result.success).toBe(false);
    expect(sets).toHaveLength(1); // credentials are not revoked when the guarded update matched nothing
    expect(sets[0]).toMatchObject({ lastHeartbeatAt: null, status: "pending" });
    expect(new PgDialect().sqlToQuery(conditions[0]).sql).toMatch(/"status" <> \$/);
  });

  it("reports a stale unhealthy agent as disconnected but keeps pending agents pending", async () => {
    const base = { name: "a", version: "1", agentMode: "sre", supportsSreConnectors: true, region: null, networkLabel: null, lastError: null, projectId: null };
    mockRows = [
      { ...base, id: "u", status: "unhealthy", lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
      { ...base, id: "p", status: "pending", lastHeartbeatAt: null },
    ];
    const result = await getPrivateAgents();
    expect(result.agents.map((a) => [a.id, a.status])).toEqual([["u", "disconnected"], ["p", "pending"]]);
  });
});
