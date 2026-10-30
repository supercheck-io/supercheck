/** @jest-environment node */

import { NextRequest } from "next/server";

const mockSelectLimit = jest.fn();
const mockSelectWhere = jest.fn((_condition: SQL) => ({ limit: mockSelectLimit }));
const mockTransaction = jest.fn();
const mockUpdateSet = jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) }));

jest.mock("@/utils/db", () => ({
  db: {
    update: () => ({ set: mockUpdateSet }),
    select: () => ({ from: () => ({ where: mockSelectWhere }) }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

jest.mock("../auth", () => ({
  authenticatePrivateAgent: jest.fn(),
  unauthorized: jest.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
}));

import { POST } from "./route";
import { hashConnectorPayload } from "@/lib/sre/connectors";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { authenticatePrivateAgent: mockAuth } = jest.requireMock("../auth") as { authenticatePrivateAgent: jest.Mock };

const jobId = "00000000-0000-4000-8000-000000000010";
const body = { jobId, leaseToken: "scl_" + "a".repeat(40), status: "completed" };

function request(payload: unknown, raw = false) {
  return new NextRequest("http://localhost/api/private-agents/jobs/result", {
    method: "POST",
    body: raw ? (payload as string) : JSON.stringify(payload),
  });
}

describe("Private Agent job result route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      agent: { id: "agent-1", organizationId: "org-1" },
      credential: { id: "cred-1" },
    });
  });

  it("returns 400 for malformed JSON instead of 500", async () => {
    const response = await POST(request("{not json", true));
    expect(response.status).toBe(400);
  });

  it("fails the job when the result is rejected by schema validation so it is not re-leased forever", async () => {
    const evidence = [{
      id: "e1", sourceUri: "x".repeat(1001), title: "t", summary: "s", evidenceType: "log",
      observedAt: new Date().toISOString(), resultHash: "a".repeat(64),
    }];
    const response = await POST(request({ ...body, evidence }));
    expect(response.status).toBe(400);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "result_rejected" }));
  });

  it("returns 409 when the lease is unknown or expired", async () => {
    mockSelectLimit.mockResolvedValue([]);
    const response = await POST(request(body));
    expect(response.status).toBe(409);
  });

  it("scopes the read to the authenticated tenant and retains the atomic lease/state guard", async () => {
    mockSelectLimit.mockResolvedValue([{ id: jobId, status: "leased", leaseExpiresAt: new Date(Date.now() + 60_000) }]);
    const guardedWhere = jest.fn((_condition: SQL) => ({ returning: async () => [{ id: jobId }] }));
    mockTransaction.mockImplementation(async (fn) => fn({
      update: () => ({ set: () => ({ where: guardedWhere }) }),
    }));
    expect((await POST(request(body))).status).toBe(200);
    const dialect = new PgDialect();
    const read = dialect.sqlToQuery(mockSelectWhere.mock.calls[0][0]);
    expect(read.params).toEqual(expect.arrayContaining([jobId, "agent-1", "org-1", hashApiKey(body.leaseToken)]));
    const write = dialect.sqlToQuery(guardedWhere.mock.calls[0][0]);
    expect(write.sql).toContain('"lease_token_hash"');
    expect(write.sql).toContain('"status"');
    expect(write.params).toEqual(expect.arrayContaining([jobId, hashApiKey(body.leaseToken), "leased", "running"]));
  });

  it("rejects an expired active lease without writing", async () => {
    mockSelectLimit.mockResolvedValue([{ id: jobId, status: "leased", leaseExpiresAt: new Date(0) }]);
    expect((await POST(request(body))).status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent or replayed post already finished the job", async () => {
    mockSelectLimit.mockResolvedValue([{ id: jobId, status: "leased", leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: null }]);
    // The guarded UPDATE ... RETURNING matches no row because the job is no longer leased/running.
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      }),
    );
    const response = await POST(request(body));
    expect(response.status).toBe(409);
  });

  it("acknowledges an identical result replay without writing, even after lease expiry", async () => {
    mockSelectLimit.mockResolvedValue([{
      id: jobId,
      status: "completed",
      leaseExpiresAt: new Date(0),
      errorCode: null,
      resultHash: hashConnectorPayload({ evidence: [], truncated: false }),
      resultSummary: { evidence: [], truncated: false, receivedAt: "2026-10-10T00:00:00Z" },
    }]);
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, alreadyAccepted: true });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { status: "failed" },
    { resultHash: "b".repeat(64) },
    { resultSummary: { evidence: [], truncated: true } },
    { errorCode: "different-error" },
  ])("rejects a different terminal result (%j)", async (change) => {
    mockSelectLimit.mockResolvedValue([{
      id: jobId,
      status: "completed",
      leaseExpiresAt: new Date(0),
      errorCode: null,
      resultHash: hashConnectorPayload({ evidence: [], truncated: false }),
      resultSummary: { evidence: [], truncated: false },
      ...change,
    }]);
    expect((await POST(request(body))).status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("acknowledges an identical result accepted during a concurrent guarded update", async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ id: jobId, status: "leased", leaseExpiresAt: new Date(Date.now() + 60_000) }])
      .mockResolvedValueOnce([{
        id: jobId, status: "completed", errorCode: null,
        resultHash: hashConnectorPayload({ evidence: [], truncated: false }),
        resultSummary: { evidence: [], truncated: false },
      }]);
    mockTransaction.mockImplementation(async (fn) => fn({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    }));
    expect((await POST(request(body))).status).toBe(200);
  });

  it("redacts secrets an agent echoes in its error code before storing it", async () => {
    const sets: Array<Record<string, unknown>> = [];
    mockSelectLimit.mockResolvedValueOnce([{ id: jobId, status: "leased", leaseExpiresAt: new Date(Date.now() + 60_000) }]);
    mockTransaction.mockImplementation(async (fn) => fn({
      update: () => ({
        set: (values: Record<string, unknown>) => {
          sets.push(values);
          return { where: () => Object.assign(Promise.resolve([]), { returning: async () => [{ id: jobId }] }) };
        },
      }),
    }));
    await POST(request({ ...body, status: "failed", errorCode: "HTTP 401 token=abc123secret" }));
    expect(JSON.stringify(sets)).not.toContain("abc123secret");
    expect(sets).toContainEqual(expect.objectContaining({ errorCode: "HTTP 401 token=[REDACTED]" }));
  });
});
