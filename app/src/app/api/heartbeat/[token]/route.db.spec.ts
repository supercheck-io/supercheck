/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
// Redis is down for this suite: pings must still be recorded (fail open).
jest.mock("@/lib/queue", () => ({ getRedisConnection: async () => { throw new Error("ECONNREFUSED"); } }));
const mockLog = jest.fn();
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: (...a: unknown[]) => mockLog(...a), info: (...a: unknown[]) => mockLog(...a), error: (...a: unknown[]) => mockLog(...a), debug: (...a: unknown[]) => mockLog(...a) }) }));

import { GET, HEAD, POST } from "./route";
import { POST as ACTION } from "./[action]/route";
import { createHeartbeatTokenColumns } from "@/lib/heartbeat/token";

const execFileAsync = promisify(execFile);
const dbName = `heartbeat_ping_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;
let projectId: string;

async function heartbeat(overrides: Partial<typeof schema.monitors.$inferInsert> = {}, org = orgId, project = projectId) {
  const columns = createHeartbeatTokenColumns(project);
  const [row] = await mockDatabase.insert(schema.monitors).values({
    organizationId: org, projectId: project, name: "Nightly backup", type: "heartbeat", target: "", frequencyMinutes: 60, status: "pending",
    heartbeatTokenHash: columns.heartbeatTokenHash, heartbeatTokenEncrypted: columns.heartbeatTokenEncrypted, ...overrides,
  }).returning();
  return { id: row.id, token: columns.token };
}
const read = async (id: string) =>
  (await mockDatabase.select({ state: schema.monitors.heartbeatState, lastCheckAt: schema.monitors.lastCheckAt }).from(schema.monitors).where(eq(schema.monitors.id, id)))[0];
const call = (handler: typeof GET, token: string, method = "GET") =>
  handler(new Request(`https://app.test/api/heartbeat/${token}`, { method, headers: { "user-agent": "x".repeat(300) } }), { params: Promise.resolve({ token }) });
const callAction = (token: string, action: string) =>
  ACTION(new Request(`https://app.test/api/heartbeat/${token}/${action}`, { method: "POST" }), { params: Promise.resolve({ token, action }) });

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  process.env.SECRET_ENCRYPTION_KEY ??= "test-secret-encryption-key-0123456789abcdef";
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  [orgId, projectId] = [org.id, project.id];
});

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("GET, POST and HEAD each record a ping (pingSeq, lastPingAt, last_check_at) with Redis down", async () => {
  const { id, token } = await heartbeat();
  for (const [handler, method] of [[GET, "GET"], [POST, "POST"], [HEAD, "HEAD"]] as const) {
    const res = await call(handler, token, method);
    expect(res.status).toBe(200);
  }
  const { state, lastCheckAt } = await read(id);
  expect(state?.pingSeq).toBe(3);
  expect(state?.lastPingKind).toBe("ping");
  expect(state?.lastPingAt).toEqual(expect.any(String));
  expect(state?.lastUserAgent).toHaveLength(120);
  expect(lastCheckAt).toBeInstanceOf(Date);
});

it("/start sets lastStartAt without counting a ping; /fail counts a failed ping", async () => {
  const { id, token } = await heartbeat();
  expect((await callAction(token, "start")).status).toBe(200);
  let { state, lastCheckAt } = await read(id);
  expect(state?.lastStartAt).toEqual(expect.any(String));
  expect(state?.pingSeq).toBeUndefined();
  expect(lastCheckAt).toBeNull();
  expect((await callAction(token, "fail")).status).toBe(200);
  ({ state } = await read(id));
  expect(state).toMatchObject({ lastPingKind: "fail", pingSeq: 1, failSeq: 1, lastFailAt: expect.any(String) });
  // A success ping after the fail keeps the fail count, so the sweep can still record the failure.
  expect((await call(GET, token)).status).toBe(200);
  ({ state } = await read(id));
  expect(state).toMatchObject({ lastPingKind: "ping", pingSeq: 2, failSeq: 1 });
});

it("keeps keys written by others (anchorAt, sweep bookkeeping)", async () => {
  const { id, token } = await heartbeat({ heartbeatState: { anchorAt: "2026-01-01T00:00:00.000Z", evaluatedSeq: 7, pingSeq: 7 } });
  await call(GET, token);
  expect((await read(id)).state).toMatchObject({ anchorAt: "2026-01-01T00:00:00.000Z", evaluatedSeq: 7, pingSeq: 8 });
});

it("unknown, malformed, paused, disabled, deleting and pending-deletion tokens answer the same 200 OK and change nothing", async () => {
  const [pendingOrg] = await mockDatabase.insert(schema.organization).values({ name: "Leaving", createdAt: new Date(), deletionRequestedAt: new Date() }).returning();
  const [pendingProject] = await mockDatabase.insert(schema.projects).values({ organizationId: pendingOrg.id, name: "L" }).returning();
  const cases = [
    await heartbeat({ status: "paused", enabled: false }),
    await heartbeat({ enabled: false }),
    await heartbeat({ deletingAt: new Date() }),
    await heartbeat({}, pendingOrg.id, pendingProject.id),
  ];
  const responses = [
    await call(GET, `hb_${"9".repeat(32)}`),
    await call(GET, "not-a-token"),
    ...(await Promise.all(cases.map(({ token }) => call(GET, token)))),
  ];
  for (const res of responses) {
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  }
  for (const { id } of cases) expect(await read(id)).toEqual({ state: null, lastCheckAt: null });
});

it("never logs the token, the monitor name or the organization", async () => {
  const { token } = await heartbeat();
  await call(GET, token);
  const logged = JSON.stringify(mockLog.mock.calls);
  for (const secret of [token, "Nightly backup", orgId]) expect(logged).not.toContain(secret);
});
