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

import { GET as orgStats } from "@/app/api/organizations/stats/route";
import { GET as projectGet } from "@/app/api/projects/[id]/route";
import { GET as monitorStats } from "@/app/api/monitors/[id]/stats/route";
import { PATCH as monitorTags, POST as monitorTagsReplace } from "@/app/api/monitors/[id]/tags/route";
import { GET as keysList, POST as keysCreate } from "@/app/api/jobs/[id]/api-keys/route";

const name = `deleting_reads_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let live: { jobId: string; monitorId: string };
let gone: { jobId: string; monitorId: string };
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
    return { jobId: job.id, monitorId: monitor.id };
  };
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
    expect([org.data.jobs, org.data.monitors]).toEqual([1, 1]);
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
