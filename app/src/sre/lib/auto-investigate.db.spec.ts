/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/sre/notification-policy", () => ({ getNotificationPolicy: async () => ({ autoInvestigateOnOpen: true }) }));
jest.mock("@/lib/ai/ai-provider", () => ({ validateAIConfiguration: () => undefined }));
jest.mock("@/lib/sre/investigation-billing", () => ({ assertCanStartSreInvestigation: async () => undefined }));
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ sreDailyTokenLimitResponse: async () => null }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreEnabled: () => true }));
const start = jest.fn();
jest.mock("@/sre/lib/investigation-runner", () => ({
  startSreIncidentInvestigation: (...a: unknown[]) => start(...a),
  completeSreIncidentInvestigation: async () => ({ success: true }),
}));
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: jest.fn() }));

import { maybeAutoInvestigateOnOpen } from "./auto-investigate";

const execFileAsync = promisify(execFile);
const name = `auto_investigate_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let input: { organizationId: string; projectId: string; incidentId: string; userId: null };

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  jest.clearAllMocks();
  start.mockResolvedValue({ success: false, status: 502, error: "stub" });
  await client`TRUNCATE organization, "user" CASCADE`;
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [incident] = await mockDatabase
    .insert(schema.sreIncidents)
    .values({ organizationId: org.id, projectId: project.id, incidentNumber: 1, title: "Down", severity: "sev1" })
    .returning();
  input = { organizationId: org.id, projectId: project.id, incidentId: incident.id, userId: null };
});

async function run(status: "running" | "completed" | "failed" | "aborted" | "timed_out", agentType: "triage" | "investigation" = "investigation") {
  await mockDatabase.insert(schema.sreInvestigationRuns).values({
    organizationId: input.organizationId,
    projectId: input.projectId,
    incidentId: input.incidentId,
    agentType,
    status,
    modelId: "m",
  } as never);
}

it.each(["failed", "aborted", "timed_out"] as const)("retries after a %s run", async (status) => {
  await run(status);
  await maybeAutoInvestigateOnOpen(input);
  expect(start).toHaveBeenCalledTimes(1);
});

it.each(["running", "completed"] as const)("does not start again after a %s run", async (status) => {
  await run(status);
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "already_investigated" });
  expect(start).not.toHaveBeenCalled();
});

it("is not blocked by a manual triage when a SEV1 needs its automatic investigation", async () => {
  await run("completed", "triage");
  await run("failed", "triage");
  await run("failed", "triage");
  await maybeAutoInvestigateOnOpen(input);
  expect(start).toHaveBeenCalledTimes(1);
});

it("still counts running runs of every agent type toward the org concurrency cap", async () => {
  for (let i = 0; i < 3; i++) {
    const [incident] = await mockDatabase
      .insert(schema.sreIncidents)
      .values({ organizationId: input.organizationId, projectId: input.projectId, incidentNumber: 10 + i, title: "Other", severity: "sev3" })
      .returning();
    await mockDatabase.insert(schema.sreInvestigationRuns).values({
      organizationId: input.organizationId, projectId: input.projectId, incidentId: incident.id, agentType: "triage", status: "running", modelId: "m",
    } as never);
  }
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "org_concurrency_limit" });
});

it("stops retrying after three failed automatic attempts", async () => {
  for (const status of ["failed", "aborted", "timed_out"] as const) await run(status);
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "retry_limit" });
  expect(start).not.toHaveBeenCalled();
});

it("does not hold a pooled connection while the run starts", async () => {
  let idleInTransaction = -1;
  start.mockImplementationOnce(async () => {
    const [row] = await maintenance`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${name} AND state = 'idle in transaction'`;
    idleInTransaction = row.n;
    return { success: false, status: 502, error: "stub" };
  });
  await maybeAutoInvestigateOnOpen(input);
  expect(idleInTransaction).toBe(0);
});

it("rejects a second running run for the same incident and agent type", async () => {
  await run("running");
  await expect(run("running")).rejects.toMatchObject({
    cause: { code: "23505", constraint_name: "sre_investigation_runs_active_incident_unique" },
  });
});
