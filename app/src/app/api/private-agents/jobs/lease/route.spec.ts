/** @jest-environment node */
jest.mock("@/lib/deletion/org-state");

import { NextRequest } from "next/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("@/utils/db", () => ({
  db: {
    transaction: jest.fn(),
    query: { externalConnectorCredentials: { findFirst: jest.fn() }, externalConnectors: { findFirst: jest.fn() } },
    update: jest.fn(),
    select: jest.fn(),
  },
}));
jest.mock("@/lib/sre/connectors", () => ({ decryptConnectorCredential: jest.fn() }));

jest.mock("../auth", () => ({
  authenticatePrivateAgent: jest.fn(),
  unauthorized: jest.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
}));

import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    transaction: jest.Mock;
    query: { externalConnectorCredentials: { findFirst: jest.Mock }; externalConnectors: { findFirst: jest.Mock } };
    update: jest.Mock;
    select: jest.Mock;
  };
};

const { authenticatePrivateAgent: mockAuthenticatePrivateAgent } = jest.requireMock("../auth") as {
  authenticatePrivateAgent: jest.Mock;
};

describe("Private Agent job lease route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticatePrivateAgent.mockResolvedValue({
      agent: {
        id: "00000000-0000-0000-0000-000000000001",
        organizationId: "00000000-0000-0000-0000-000000000002",
        supportsSreConnectors: true,
      },
      credential: {
        id: "00000000-0000-0000-0000-000000000003",
      },
    });
  });

  it("leases nothing to an agent of an organization pending deletion", async () => {
    const { isOrgPendingDeletion } = jest.requireMock("@/lib/deletion/org-state");
    isOrgPendingDeletion.mockResolvedValue(true);
    try {
      const response = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", { method: "POST", body: JSON.stringify({}) }));
      expect(isOrgPendingDeletion).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000002", { fresh: true });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ job: null });
    } finally {
      isOrgPendingDeletion.mockResolvedValue(false);
    }
  });

  it("requeues expired connector leases before returning no work", async () => {
    const updateSets: Array<Record<string, unknown>> = [];

    const createTx = () => ({
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updateSets.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        }),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([]),
            })),
            limit: jest.fn().mockResolvedValue([{ id: "cred" }]),
          })),
        })),
      })),
    });

    mockDb.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof createTx>) => Promise<unknown>) =>
      callback(createTx())
    );

    const request = new NextRequest("http://localhost/api/private-agents/jobs/lease", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waitMs: 0 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ job: null });
    expect(updateSets).toContainEqual({
      status: "queued",
      leaseTokenHash: null,
      leaseExpiresAt: null,
      startedAt: null,
    });
  });

  it("fails an expired connector credential without decrypting or handing it to the agent", async () => {
    const leasedJob = {
      id: "00000000-0000-4000-8000-000000000010",
      connectorId: "00000000-0000-4000-8000-000000000011",
      organizationId: "00000000-0000-0000-0000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000012",
    };
    mockDb.transaction.mockResolvedValueOnce(leasedJob);
    mockDb.query.externalConnectorCredentials.findFirst.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1_000),
      encryptedCredential: "expired-secret",
    });
    const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) }));
    mockDb.update.mockReturnValue({ set });
    const response = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", {
      method: "POST",
      body: JSON.stringify({ waitMs: 0 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: null });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "connector_credential_expired",
    }));
    expect(jest.requireMock("@/lib/sre/connectors").decryptConnectorCredential).not.toHaveBeenCalled();
  });

  it("fails stale queued jobs and jobs of disabled or reassigned connectors before selecting work", async () => {
    const updateSets: Array<Record<string, unknown>> = [];
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updateSets.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        }),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ orderBy: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })), limit: jest.fn().mockResolvedValue([{ id: "cred" }]) })),
        })),
      })),
    };
    mockDb.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const response = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", {
      method: "POST",
      body: JSON.stringify({ waitMs: 0 }),
    }));
    expect(response.status).toBe(200);
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "timed_out", errorCode: "queued_too_long" }));
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "failed", errorCode: "connector_disabled" }));
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "failed", errorCode: "connector_reassigned" }));
  });

  it("never selects a queued job of a soft-deleted project", async () => {
    let selection: SQL | undefined;
    const tx = {
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })) })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn((where: SQL) => ({
            orderBy: jest.fn(() => { selection = where; return { limit: jest.fn().mockResolvedValue([]) }; }),
            limit: jest.fn().mockResolvedValue([{ id: "cred" }]),
          })),
        })),
      })),
    };
    mockDb.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", { method: "POST", body: JSON.stringify({ waitMs: 0 }) }));
    expect(selection).toBeDefined();
    expect(new PgDialect().sqlToQuery(selection!).sql).toMatch(/"status" = 'deleted'/);
  });

  it("leases nothing when the credential was revoked after authentication", async () => {
    const selectedWork = jest.fn();
    const sets: Array<Record<string, unknown>> = [];
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          sets.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        }),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
            orderBy: selectedWork,
          })),
        })),
      })),
    };
    mockDb.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    mockDb.update.mockReturnValue({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })) });
    const response = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", {
      method: "POST",
      body: JSON.stringify({ waitMs: 0 }),
    }));
    expect(await response.json()).toEqual({ job: null });
    // Only the agent heartbeat touch runs; no job state is changed.
    expect(sets.every((values) => !("status" in values && values.status !== undefined))).toBe(true);
    expect(selectedWork).not.toHaveBeenCalled();
  });
});

describe("Private Agent job lease route long poll", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAuthenticatePrivateAgent.mockResolvedValue({
      agent: { id: "a", organizationId: "o", supportsSreConnectors: true },
      credential: { id: "c" },
    });
    mockDb.update.mockReturnValue({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })) });
    mockDb.transaction.mockImplementation(async () => null);
  });
  afterEach(() => jest.useRealTimers());

  const poll = async (waitMs: number, advanceMs: number) => {
    const pending = POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", { method: "POST", body: JSON.stringify({ waitMs }) }));
    await jest.advanceTimersByTimeAsync(advanceMs);
    return pending;
  };
  const probe = (found: boolean) =>
    mockDb.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => (found ? [{ id: "j" }] : []) }) }) });

  it("idle ticks only probe; the full transaction runs on the first tick and every 5s", async () => {
    probe(false);
    const res = await poll(12_000, 12_000);
    expect(await res.json()).toEqual({ job: null });
    // full ticks at t=0, 5s, 10s plus the final touchAgent; 12 one-second ticks, 2 of them full
    expect(mockDb.transaction.mock.calls.length).toBe(3 + 1);
    expect(mockDb.select.mock.calls.length).toBe(10);
  });

  it("runs the full transaction (credential check included) as soon as queued work appears", async () => {
    probe(true);
    await poll(3_000, 3_000);
    // initial tick, a full tick on each of the 3 probe hits, and touchAgent
    expect(mockDb.transaction.mock.calls.length).toBe(1 + 3 + 1);
  });

  it("does not probe when waitMs is 0", async () => {
    probe(true);
    await poll(0, 0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

describe("Private Agent job lease route MCP endpoint", () => {
  it("restores the full MCP endpoint from the credential, leaving other connectors untouched", async () => {
    const { decryptConnectorCredential } = jest.requireMock("@/lib/sre/connectors") as { decryptConnectorCredential: jest.Mock };
    mockDb.query.externalConnectorCredentials.findFirst.mockResolvedValue({
      credentialType: "api_key",
      encryptedCredential: "enc",
      expiresAt: null,
    });
    decryptConnectorCredential.mockReturnValue({ endpointUrl: "https://mcp.example/mcp?key=SECRET" });
    const base = {
      id: "j",
      jobClass: "sre_connector_query",
      connectorId: "c",
      organizationId: "o",
      projectId: "p",
      jobSpecHash: "h".repeat(64),
      policyDecisionHash: "x",
      leaseExpiresAt: new Date(),
    };
    const lease = async (jobSpec: Record<string, unknown>) => {
      mockDb.transaction.mockResolvedValueOnce({ ...base, jobSpec });
      const res = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", { method: "POST", body: "{}" }));
      return (await res.json()).job.jobSpec;
    };
    expect(await lease({ connectorType: "mcp", endpointUrl: "https://mcp.example/mcp?…" })).toMatchObject({
      endpointUrl: "https://mcp.example/mcp?key=SECRET",
    });
    expect(await lease({ connectorType: "datadog", endpointUrl: "https://api.datadoghq.com" })).toMatchObject({
      endpointUrl: "https://api.datadoghq.com",
    });
  });

  const leaseMcp = async (jobSpec: Record<string, unknown>, credentialValue: Record<string, unknown> | null) => {
    const { decryptConnectorCredential } = jest.requireMock("@/lib/sre/connectors") as { decryptConnectorCredential: jest.Mock };
    mockDb.query.externalConnectorCredentials.findFirst.mockResolvedValue(
      credentialValue ? { credentialType: "api_key", encryptedCredential: "enc", expiresAt: null } : null,
    );
    decryptConnectorCredential.mockReturnValue(credentialValue);
    mockDb.transaction.mockResolvedValueOnce({
      id: "j", jobClass: "sre_connector_query", connectorId: "c", organizationId: "o", projectId: "p",
      jobSpecHash: "h".repeat(64), policyDecisionHash: "x", leaseExpiresAt: new Date(), jobSpec,
    });
    const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) }));
    mockDb.update.mockReturnValue({ set });
    const res = await POST(new NextRequest("http://localhost/api/private-agents/jobs/lease", { method: "POST", body: "{}" }));
    return { body: await res.json(), set };
  };

  it("fails an MCP job whose redacted endpoint cannot be restored, but leases a query-free one", async () => {
    const missing = await leaseMcp({ connectorType: "mcp", endpointUrl: "https://mcp.example/mcp?…" }, null);
    expect(missing.body).toEqual({ job: null });
    expect(missing.set).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "mcp_endpoint_missing" }));
    const plain = await leaseMcp({ connectorType: "mcp", endpointUrl: "https://mcp.example/mcp" }, null);
    expect(plain.body.job.jobSpec.endpointUrl).toBe("https://mcp.example/mcp");    // A job queued before redaction still holds its full URL and must keep leasing.
    const legacy = await leaseMcp({ connectorType: "mcp", endpointUrl: "https://mcp.example/mcp?key=SECRET" }, null);
    expect(legacy.body.job.jobSpec.endpointUrl).toBe("https://mcp.example/mcp?key=SECRET");
  });

  it("fails a queued MCP tool call whose tool is now destructive or no longer allowlisted", async () => {
    const spec = { connectorType: "mcp", endpointUrl: "https://mcp.example/mcp", filters: { mcp: { kind: "call_tool", tool: "wipe", arguments: {} } } };
    const entry = { name: "wipe", description: "", inputSchema: { type: "object", properties: {} }, fixedArguments: {} };
    for (const mcp of [
      { discovered: [], allowlist: [{ ...entry, destructiveHint: true }] },
      { discovered: [], allowlist: [] },
    ]) {
      mockDb.query.externalConnectors.findFirst.mockResolvedValue({ config: { mcp } });
      const r = await leaseMcp(spec, null);
      expect(r.body).toEqual({ job: null });
      expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "mcp_tool_not_allowed" }));
    }
    mockDb.query.externalConnectors.findFirst.mockResolvedValue({ config: { mcp: { discovered: [], allowlist: [entry] } } });
    expect((await leaseMcp(spec, null)).body.job).toBeTruthy();
  });
});
