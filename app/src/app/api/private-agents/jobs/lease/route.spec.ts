/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    transaction: jest.fn(),
    query: { externalConnectorCredentials: { findFirst: jest.fn() } },
    update: jest.fn(),
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
    query: { externalConnectorCredentials: { findFirst: jest.Mock } };
    update: jest.Mock;
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
});
