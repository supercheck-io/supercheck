/** @jest-environment node */
// Lease -> execute -> result through the real route handlers. Only the database
// and agent authentication are faked; the fake enforces the lease-token guard
// from the SQL parameters the routes actually send. The agent side mirrors
// worker/src/private-agent/private-agent-runner.ts (leaseJob/submitResult); its
// process-level behaviour is covered by the worker specs.
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

import { privateAgentJobs } from "@/db/schema";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { hashConnectorPayload } from "@/lib/sre/connectors";

type StoredJob = Record<string, any>;
const state: { job: StoredJob } = { job: {} };
const dialect = new PgDialect();
const paramsOf = (condition: SQL) => dialect.sqlToQuery(condition).params;

function newJob(): StoredJob {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    privateAgentId: "agent-1",
    organizationId: "org-1",
    projectId: "00000000-0000-4000-8000-000000000012",
    connectorId: null,
    jobClass: "sre_connector_query",
    jobSpec: { serviceId: "service-1", query: "error rate" },
    jobSpecHash: "a".repeat(64),
    policyDecisionHash: "b".repeat(64),
    status: "queued",
    createdAt: new Date(),
    leaseTokenHash: null,
    leaseExpiresAt: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    errorCode: null,
    resultHash: null,
    resultSummary: null,
  };
}

function update(table: unknown) {
  return {
    set: (values: Record<string, any>) => ({
      where: (condition: SQL) => {
        let rows: Array<{ id: string }> = [];
        if (table === privateAgentJobs) {
          const job = state.job;
          const active = ["leased", "running"].includes(job.status);
          if (values.status === "queued") {
            if (active && job.leaseExpiresAt <= new Date()) Object.assign(job, values);
          } else if (values.status === "leased") {
            if (job.status === "queued") { Object.assign(job, values); rows = [job as { id: string }]; }
          } else if (active && paramsOf(condition).includes(job.leaseTokenHash)) {
            Object.assign(job, values);
            rows = [{ id: job.id }];
          }
        }
        return { returning: async () => rows, then: (resolve: (v: unknown) => void) => resolve(rows) };
      },
    }),
  };
}

jest.mock("@/utils/db", () => {
  const select = () => ({
    from: () => ({
      where: (condition: SQL) => {
        const rows = () => {
          const params = paramsOf(condition);
          const job = state.job;
          // Lease read: oldest queued job. Result read: must carry the lease-token hash.
          if (job.status === "queued" && params.includes("queued")) return [job];
          if (job.leaseTokenHash && params.includes(job.leaseTokenHash) && params.includes(job.id)) return [job];
          return [];
        };
        return { orderBy: () => ({ limit: async () => rows() }), limit: async () => rows() };
      },
    }),
  });
  const db = {
    select,
    update: (table: unknown) => update(table),
    transaction: async (fn: (tx: unknown) => unknown) => fn({ select, update: (table: unknown) => update(table) }),
    query: { externalConnectorCredentials: { findFirst: async () => null } },
  };
  return { db };
});
jest.mock("./auth", () => ({
  authenticatePrivateAgent: jest.fn(async () => ({
    agent: { id: "agent-1", organizationId: "org-1", supportsSreConnectors: true },
    credential: { id: "cred-1" },
  })),
  unauthorized: jest.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
}));

import { POST as lease } from "./lease/route";
import { POST as result } from "./result/route";

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

const evidence = [{
  id: "ev-1",
  sourceUri: "https://metrics.example/graph?q=1",
  title: "Checkout error rate",
  summary: "5xx rate rose to 4%",
  evidenceType: "metric",
  observedAt: "2026-09-08T09:00:00.000Z",
  resultHash: "c".repeat(64),
}];

describe("Private Agent job round trip", () => {
  beforeEach(() => { state.job = newJob(); });

  async function leaseNext() {
    const response = await lease(post("/api/private-agents/jobs/lease", { waitMs: 0 }));
    expect(response.status).toBe(200);
    return response.json() as Promise<{ job: StoredJob | null; leaseToken?: string }>;
  }

  it("leases a queued job, accepts the executed result, and ignores an identical replay", async () => {
    const leased = await leaseNext();
    expect(leased.job).toMatchObject({ id: state.job.id, jobClass: "sre_connector_query", jobSpec: { serviceId: "service-1" }, credential: null });
    expect(leased.leaseToken).toMatch(/^scl_/);
    expect(state.job).toMatchObject({ status: "leased", leaseTokenHash: hashApiKey(leased.leaseToken as string) });
    expect(state.job.leaseTokenHash).not.toBe(leased.leaseToken);

    const payload = {
      jobId: leased.job?.id,
      leaseToken: leased.leaseToken,
      status: "completed",
      resultHash: hashConnectorPayload({ evidence, truncated: false }),
      evidence,
      truncated: false,
    };
    const accepted = await result(post("/api/private-agents/jobs/result", payload));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true });
    expect(state.job).toMatchObject({ status: "completed", resultHash: payload.resultHash, errorCode: null });
    expect(state.job.resultSummary.evidence).toEqual(evidence);

    const replay = await result(post("/api/private-agents/jobs/result", payload));
    expect(await replay.json()).toEqual({ ok: true, alreadyAccepted: true });
    expect((await leaseNext()).job).toBeNull();
  });

  it("rejects a result carrying the wrong lease token and leaves the job leased", async () => {
    const leased = await leaseNext();
    const response = await result(post("/api/private-agents/jobs/result", {
      jobId: leased.job?.id,
      leaseToken: `scl_${"f".repeat(64)}`,
      status: "completed",
      evidence,
    }));
    expect(response.status).toBe(409);
    expect(state.job.status).toBe("leased");
  });

  it("records a failed execution with its error code and no evidence", async () => {
    const leased = await leaseNext();
    const response = await result(post("/api/private-agents/jobs/result", {
      jobId: leased.job?.id, leaseToken: leased.leaseToken, status: "failed", errorCode: "connector_unreachable",
    }));
    expect(response.status).toBe(200);
    expect(state.job).toMatchObject({ status: "failed", errorCode: "connector_unreachable" });
    expect(state.job.resultSummary.evidence).toEqual([]);
  });

  it("requeues a job whose lease expired so the next lease can pick it up", async () => {
    const first = await leaseNext();
    state.job.leaseExpiresAt = new Date(Date.now() - 1000);
    const second = await leaseNext();
    expect(second.job?.id).toBe(first.job?.id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    const stale = await result(post("/api/private-agents/jobs/result", {
      jobId: first.job?.id, leaseToken: first.leaseToken, status: "completed", evidence,
    }));
    expect(stale.status).toBe(409);
  });
});
