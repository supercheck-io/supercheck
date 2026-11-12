/** @jest-environment node */
// Needs TEST_DATABASE_URL (npm run test:db). A target flagged `deleting` must read as missing and must not be counted.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
let ctx: { userId: string; organizationId: string; isCliAuth: boolean; project: { id: string } };
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ctx),
  requireUserAuthContext: jest.fn(async () => ctx),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: () => true,
  hasPermissionForUser: async () => true,
  getUserOrgRole: async () => "org_owner",
  forbiddenOrNotFound: async () => new Response(null, { status: 404 }),
  isImpersonatedSession: async () => false,
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(async () => undefined) }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: async () => false }));
jest.mock("@/lib/queue", () => ({ getCapacityQueues: async () => ({}) }));
jest.mock("@/lib/capacity-manager", () => ({ getCapacityManager: () => ({}) }));
jest.mock("@/lib/cancellation-service", () => ({ RUN_CANCELLATION_MARKER: "Cancellation requested by user", setCancellationSignal: jest.fn() }));

import { GET as orgStats } from "@/app/api/organizations/stats/route";
import { GET as projectGet } from "@/app/api/projects/[id]/route";
import { GET as monitorStats } from "@/app/api/monitors/[id]/stats/route";
import { PATCH as monitorTags, POST as monitorTagsReplace } from "@/app/api/monitors/[id]/tags/route";
import { GET as keysList, POST as keysCreate } from "@/app/api/jobs/[id]/api-keys/route";
import { GET as runStatus } from "@/app/api/runs/[runId]/status/route";
import { GET as runPermissions } from "@/app/api/runs/[runId]/permissions/route";
import { POST as runCancel } from "@/app/api/runs/[runId]/cancel/route";
import { GET as runStream } from "@/app/api/runs/[runId]/stream/route";
import { GET as k6Run } from "@/app/api/k6/runs/[runId]/route";
import { GET as runDetail } from "@/app/api/runs/[runId]/route";
import { GET as runsList } from "@/app/api/runs/route";
import { GET as jobStatusRun } from "@/app/api/job-status/events/[runId]/route";
import { resolveAccessContext } from "@/lib/test-results-access";
import { resolveRunArtifact } from "@/lib/ai/run-artifact";

const name = `deleting_reads_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let live: { jobId: string; monitorId: string; runId: string; k6RunId: string };
let gone: { jobId: string; monitorId: string; runId: string; k6RunId: string };
let jobless: string;
let projectId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
  });
  client = postgres(target.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  projectId = project.id;
  const make = async () => {
    const [job] = await mockDatabase.insert(schema.jobs).values({ organizationId: org.id, projectId, name: "J" }).returning();
    const [monitor] = await mockDatabase.insert(schema.monitors).values({ organizationId: org.id, projectId, name: "M", type: "website", target: "https://example.test" }).returning();
    const [run] = await mockDatabase.insert(schema.runs).values({ jobId: job.id, projectId, status: "passed" }).returning();
    const [k6] = await mockDatabase.insert(schema.k6PerformanceRuns).values({ jobId: job.id, runId: run.id, organizationId: org.id, projectId, status: "passed" }).returning();
    return { jobId: job.id, monitorId: monitor.id, runId: run.id, k6RunId: k6.id };
  };
  [{ id: jobless }] = await mockDatabase.insert(schema.runs).values({ projectId, status: "passed" }).returning();
  live = await make();
  gone = await make();
  await client`UPDATE jobs SET deleting_at = now() WHERE id = ${gone.jobId}`;
  await client`UPDATE monitors SET deleting_at = now() WHERE id = ${gone.monitorId}`;
  ctx = { userId: randomUUID(), organizationId: org.id, isCliAuth: false, project: { id: projectId } };
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);

describe("targets flagged deleting", () => {
  it("are not counted in organization or project stats", async () => {
    const org = await (await orgStats()).json();
    expect([org.data.jobs, org.data.monitors, org.data.runs]).toEqual([1, 1, 1]);
    const project = await (await projectGet(req(`/api/projects/${projectId}`), params(projectId))).json();
    expect([project.project.stats.jobCount, project.project.stats.monitorCount]).toEqual([1, 1]);
  });

  it("read as not found on per-id monitor routes", async () => {
    expect((await monitorStats(req(`/api/monitors/${live.monitorId}/stats`), params(live.monitorId))).status).not.toBe(404); // the aggregation service is stubbed, so only "found" is asserted
    expect((await monitorStats(req(`/api/monitors/${gone.monitorId}/stats`), params(gone.monitorId))).status).toBe(404);
    const patch = (id: string) => monitorTags(req(`/api/monitors/${id}/tags`, { method: "PATCH", body: JSON.stringify({ add: [] }) }), params(id));
    expect((await patch(gone.monitorId)).status).toBe(404);
    expect((await patch(live.monitorId)).status).not.toBe(404);
    const replace = (id: string) => monitorTagsReplace(req(`/api/monitors/${id}/tags`, { method: "POST", body: JSON.stringify({ tagIds: [] }) }), params(id));
    expect((await replace(gone.monitorId)).status).toBe(404);
  });

  it("cannot list or mint API keys for a job being deleted", async () => {
    expect((await keysList(req(`/api/jobs/${live.jobId}/api-keys`), params(live.jobId))).status).toBe(200);
    expect((await keysList(req(`/api/jobs/${gone.jobId}/api-keys`), params(gone.jobId))).status).toBe(404);
    const create = await keysCreate(req(`/api/jobs/${gone.jobId}/api-keys`, { method: "POST", body: JSON.stringify({ name: "k" }) }), params(gone.jobId));
    expect(create.status).toBe(404);
    expect(await client`SELECT 1 FROM apikey WHERE job_id = ${gone.jobId}`).toHaveLength(0);
  });
});

describe("runs of a job being deleted", () => {
  const runParams = (runId: string) => ({ params: Promise.resolve({ runId }) });
  const get = (path: string) => req(path);
  // [name, call(runId)] for every route and helper that loads a run by id; jobless runs must stay visible.
  const paths: Array<[string, (runId: string) => Promise<{ status: number }>]> = [
    ["runs/[runId]", (id) => runDetail(get(`/api/runs/${id}`), runParams(id))],
    ["runs/[runId]/status", (id) => runStatus(get(`/api/runs/${id}/status`), runParams(id))],
    ["runs/[runId]/permissions", (id) => runPermissions(get(`/api/runs/${id}/permissions`), runParams(id))],
    ["runs/[runId]/stream", (id) => runStream(get(`/api/runs/${id}/stream`), runParams(id))],
    ["job-status/events/[runId]", (id) => jobStatusRun(get(`/api/job-status/events/${id}`))],
  ];

  it.each(paths)("%s answers not found for a run of a deleting job and still serves the live and jobless runs", async (_name, call) => {
    expect((await call(gone.runId)).status).toBe(404);
    expect((await call(live.runId)).status).not.toBe(404);
  });

  it("runs/[runId]/cancel never signals a run of a deleting job", async () => {
    const { setCancellationSignal } = jest.requireMock("@/lib/cancellation-service");
    expect((await runCancel(req(`/api/runs/${gone.runId}/cancel`, { method: "POST" }), runParams(gone.runId))).status).toBe(404);
    expect(setCancellationSignal).not.toHaveBeenCalled();
  });

  it("k6/runs/[runId] answers not found", async () => {
    expect((await k6Run(get(`/api/k6/runs/${gone.runId}`), runParams(gone.runId))).status).toBe(404);
    expect((await k6Run(get(`/api/k6/runs/${live.runId}`), runParams(live.runId))).status).not.toBe(404);
  });

  it("the run list leaves them out", async () => {
    const body = await (await runsList(get("/api/runs?limit=50"))).json();
    const ids = (body.data ?? body.runs ?? []).map((r: { id: string }) => r.id);
    expect(ids).toContain(live.runId);
    expect(ids).not.toContain(gone.runId);
  });

  it("report access and run artifact resolution do not see them", async () => {
    for (const type of ["test", "job", "k6_job"] as const) {
      expect(await resolveAccessContext(type, gone.runId)).toBeNull();
      expect(await resolveAccessContext(type, live.runId)).not.toBeNull();
    }
    expect((await resolveRunArtifact(gone.runId)).jobId).toBeNull();
    expect((await resolveRunArtifact(live.runId)).jobId).toBe(live.jobId);
  });

  it("a run without a job is unaffected", async () => {
    expect((await runStatus(get(`/api/runs/${jobless}/status`), runParams(jobless))).status).toBe(200);
    expect(await resolveAccessContext("test", jobless)).not.toBeNull();
  });
});
