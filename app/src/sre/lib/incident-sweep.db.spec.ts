/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn(async () => undefined) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(async () => undefined) }));
jest.mock("@/lib/ai/ai-provider", () => ({ validateAIConfiguration: jest.fn() }));
// Stubs the AI start only: the stub records a real run row, like the runner's insert would.
jest.mock("@/sre/lib/triage-runner", () => ({ startSreIncidentTriage: jest.fn(), completeSreIncidentTriage: jest.fn(async () => undefined) }));

import { reconcileRecoveries, retriageStaleRuns, sweepSreIncidents } from "./incident-sweep";
import { startSreIncidentTriage } from "@/sre/lib/triage-runner";
import { validateAIConfiguration } from "@/lib/ai/ai-provider";

const execFileAsync = promisify(execFile);
const dbName = `incident_sweep_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const captured: { query: string; params: unknown[] }[] = [];
const startMock = startSreIncidentTriage as jest.Mock;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for DB-backed specs");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema, logger: { logQuery: (query, params) => void captured.push({ query, params }) } });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
let counter = 0;

type Tenant = { orgId: string; projectId: string; monitorId: string; jobId: string };

async function tenant(): Promise<Tenant> {
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [monitor] = await mockDatabase
    .insert(schema.monitors)
    .values({ organizationId: org.id, projectId: project.id, name: "API", type: "http_request", target: "https://example.com", status: "down" })
    .returning();
  const [job] = await mockDatabase
    .insert(schema.jobs)
    .values({ organizationId: org.id, projectId: project.id, name: "Nightly", cronSchedule: null, status: "failed" } as never)
    .returning();
  return { orgId: org.id, projectId: project.id, monitorId: monitor.id, jobId: job.id };
}

async function setMonitor(t: Tenant, status: "up" | "down", changedMinutesAgo: number, alertConfig?: Record<string, unknown>) {
  await mockDatabase
    .update(schema.monitors)
    .set({ status, lastStatusChangeAt: minutesAgo(changedMinutesAgo), ...(alertConfig ? { alertConfig: alertConfig as never } : {}) })
    .where(eq(schema.monitors.id, t.monitorId));
}

async function jobRun(t: Tenant, status: "passed" | "failed", completedMinutesAgo: number) {
  await mockDatabase.insert(schema.runs).values({ jobId: t.jobId, projectId: t.projectId, status, completedAt: minutesAgo(completedMinutesAgo) });
}

/** An incident opened by an alert (trigger alert event linked), last alerted `alertMinutesAgo` ago. */
async function incident(
  t: Tenant,
  opts: { source?: "monitor" | "job"; sourceId?: string; alertMinutesAgo?: number; createdMinutesAgo?: number; manual?: boolean; acked?: boolean; status?: "triggered" | "resolved"; withAlert?: boolean } = {},
) {
  const source = opts.source ?? "monitor";
  const sourceId = opts.sourceId ?? (source === "monitor" ? t.monitorId : t.jobId);
  const alertAt = minutesAgo(opts.alertMinutesAgo ?? 60);
  const [user] = opts.manual ? await mockDatabase.insert(schema.user).values({ name: "U", email: `${randomUUID()}@example.com` }).returning() : [];
  const [row] = await mockDatabase
    .insert(schema.sreIncidents)
    .values({
      organizationId: t.orgId,
      projectId: t.projectId,
      incidentNumber: ++counter,
      title: "API: Monitor down",
      severity: "sev2",
      status: opts.status ?? "triggered",
      alertCount: 1,
      lastAlertAt: alertAt,
      acknowledgedAt: opts.acked ? new Date() : null,
      createdByUserId: user?.id ?? null,
      createdAt: minutesAgo(opts.createdMinutesAgo ?? 60),
      updatedAt: new Date(),
    })
    .returning();
  if (opts.withAlert === false) return row.id;
  const type = source === "monitor" ? "monitor_failure" : "job_failed";
  const dedupKey = [t.projectId, source, sourceId, type].join(":");
  const [event] = await mockDatabase
    .insert(schema.sreAlertEvents)
    .values({
      organizationId: t.orgId,
      projectId: t.projectId,
      fingerprintHash: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
      dedupKey,
      severity: "sev2",
      status: "firing",
      sourceType: source,
      sourceId,
      title: `API: ${source === "monitor" ? "Monitor down" : "Job failed"}`,
      firedAt: alertAt,
    })
    .returning();
  await mockDatabase.insert(schema.sreIncidentAlerts).values({ incidentId: row.id, alertEventId: event.id, role: "trigger", alertFiredAt: alertAt });
  return row.id;
}

async function statusOf(...ids: string[]) {
  const rows = await mockDatabase.select({ id: schema.sreIncidents.id, status: schema.sreIncidents.status }).from(schema.sreIncidents).where(inArray(schema.sreIncidents.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

async function run(
  t: Tenant,
  incidentId: string,
  opts: { origin?: "auto" | "manual"; status: "failed" | "running" | "completed"; startedMinutesAgo?: number; errorCode?: string },
) {
  await mockDatabase.insert(schema.sreInvestigationRuns).values({
    organizationId: t.orgId,
    projectId: t.projectId,
    incidentId,
    agentType: "triage",
    status: opts.status,
    modelId: "m",
    origin: opts.origin ?? "auto",
    startedAt: minutesAgo(opts.startedMinutesAgo ?? 60),
    agentStateSnapshot: opts.errorCode ? { errorCode: opts.errorCode } : null,
  });
}

const staleAuto = (t: Tenant, id: string) => run(t, id, { status: "failed", errorCode: "stale_run" });

async function runRows(incidentId: string) {
  return mockDatabase.select().from(schema.sreInvestigationRuns).where(eq(schema.sreInvestigationRuns.incidentId, incidentId));
}

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.SRE_AUTOMATION_ENABLED = "true";
  delete process.env.SRE_ENABLED;
  await client`TRUNCATE organization, "user" CASCADE`;
  (validateAIConfiguration as jest.Mock).mockReset();
  startMock.mockImplementation(async (input: { organizationId: string; projectId: string; incidentId: string }) => {
    const [row] = await mockDatabase
      .insert(schema.sreInvestigationRuns)
      .values({ organizationId: input.organizationId, projectId: input.projectId, incidentId: input.incidentId, agentType: "triage", status: "running", modelId: "m", origin: "auto" })
      .returning();
    return { success: true, investigationRunId: row.id, run: row, incident: {}, startedAt: Date.now() };
  });
});

describe("recovery reconcile", () => {
  it("resolves an open automatic incident whose monitor went up after its last alert", async () => {
    const t = await tenant();
    await setMonitor(t, "up", 10);
    const id = await incident(t, { alertMinutesAgo: 30 });
    expect(await reconcileRecoveries()).toBe(1);
    expect((await statusOf(id))[id]).toBe("resolved");
    const [row] = await mockDatabase.select().from(schema.sreIncidents).where(eq(schema.sreIncidents.id, id));
    expect(row.resolutionSummary).toContain("Recovered automatically");
    // A second sweep finds nothing left to do.
    expect(await reconcileRecoveries()).toBe(0);
  });

  it("leaves a monitor that is still down, or failed again after it came up, alone", async () => {
    const down = await tenant();
    await setMonitor(down, "down", 10);
    const downId = await incident(down, { alertMinutesAgo: 30 });
    // Up, but the incident's latest alert is newer than the recovery.
    const newer = await tenant();
    await setMonitor(newer, "up", 30);
    const newerId = await incident(newer, { alertMinutesAgo: 5 });
    expect(await reconcileRecoveries()).toBe(0);
    expect(await statusOf(downId, newerId)).toEqual({ [downId]: "triggered", [newerId]: "triggered" });
  });

  it("does not resolve over a newer failure alert recorded in alert history", async () => {
    const t = await tenant();
    await setMonitor(t, "up", 10);
    const id = await incident(t, { alertMinutesAgo: 30 });
    await mockDatabase.insert(schema.alertHistory).values({ message: "down", type: "monitor_failure", target: "API", targetType: "monitor", monitorId: t.monitorId, provider: "slack", status: "sent", sentAt: minutesAgo(1) });
    await reconcileRecoveries();
    expect((await statusOf(id))[id]).toBe("triggered");
  });

  it("never touches manual, acknowledged or source-less incidents", async () => {
    const t = await tenant();
    await setMonitor(t, "up", 10);
    const manual = await incident(t, { manual: true, alertMinutesAgo: 30 });
    const acked = await incident(t, { acked: true, alertMinutesAgo: 30 });
    const noSource = await incident(t, { withAlert: false, alertMinutesAgo: 30 });
    expect(await reconcileRecoveries()).toBe(0);
    expect(await statusOf(manual, acked, noSource)).toEqual({ [manual]: "triggered", [acked]: "triggered", [noSource]: "triggered" });
  });

  it("respects autoResolveIncident=false and a recovery threshold above 1", async () => {
    const off = await tenant();
    await setMonitor(off, "up", 10, { autoResolveIncident: false });
    const offId = await incident(off, { alertMinutesAgo: 30 });
    const streak = await tenant();
    await setMonitor(streak, "up", 10, { recoveryThreshold: 3 });
    const streakId = await incident(streak, { alertMinutesAgo: 30 });
    const one = await tenant();
    await setMonitor(one, "up", 10, { recoveryThreshold: 1, autoResolveIncident: true });
    const oneId = await incident(one, { alertMinutesAgo: 30 });
    expect(await reconcileRecoveries()).toBe(1);
    expect(await statusOf(offId, streakId, oneId)).toEqual({ [offId]: "triggered", [streakId]: "triggered", [oneId]: "resolved" });
  });

  it("job source: resolves when the latest run passed, not when it failed", async () => {
    const ok = await tenant();
    await jobRun(ok, "failed", 40);
    await jobRun(ok, "passed", 10);
    const okId = await incident(ok, { source: "job", alertMinutesAgo: 30 });
    const bad = await tenant();
    await jobRun(bad, "passed", 20);
    await jobRun(bad, "failed", 10);
    const badId = await incident(bad, { source: "job", alertMinutesAgo: 30 });
    const old = await tenant();
    await jobRun(old, "passed", 50); // passed before the last alert
    const oldId = await incident(old, { source: "job", alertMinutesAgo: 30 });
    expect(await reconcileRecoveries()).toBe(1);
    expect(await statusOf(okId, badId, oldId)).toEqual({ [okId]: "resolved", [badId]: "triggered", [oldId]: "triggered" });
  });

  it("isolates tenants: only the organization whose source recovered changes", async () => {
    const a = await tenant();
    const b = await tenant();
    await setMonitor(a, "up", 10);
    await setMonitor(b, "down", 10);
    const aId = await incident(a);
    const bId = await incident(b);
    // B's incident points at A's (recovered) monitor: a different organization must not be resolved through it.
    const crossId = await incident(b, { sourceId: a.monitorId });
    expect(await reconcileRecoveries()).toBe(1);
    expect(await statusOf(aId, bId, crossId)).toEqual({ [aId]: "resolved", [bId]: "triggered", [crossId]: "triggered" });
  });
});

describe("re-triage", () => {
  it("picks only open automatic incidents whose only automatic run failed stale, and only once", async () => {
    const t = await tenant();
    const eligible = await incident(t, { withAlert: false });
    await staleAuto(t, eligible);
    const deadRunning = await incident(t, { withAlert: false });
    await run(t, deadRunning, { status: "running", startedMinutesAgo: 30 });
    const otherError = await incident(t, { withAlert: false });
    await run(t, otherError, { status: "failed", errorCode: "provider_error" });
    const manualRun = await incident(t, { withAlert: false });
    await run(t, manualRun, { origin: "manual", status: "failed", errorCode: "stale_run" });
    const twoAuto = await incident(t, { withAlert: false });
    await staleAuto(t, twoAuto);
    await run(t, twoAuto, { status: "failed", errorCode: "provider_error" });
    const resolved = await incident(t, { withAlert: false, status: "resolved" });
    await staleAuto(t, resolved);
    const byPerson = await incident(t, { withAlert: false, manual: true });
    await staleAuto(t, byPerson);
    const old = await incident(t, { withAlert: false, createdMinutesAgo: 3 * 24 * 60 });
    await staleAuto(t, old);
    const noRun = await incident(t, { withAlert: false });

    expect(await retriageStaleRuns()).toBe(2);
    const started = startMock.mock.calls.map(([input]) => input.incidentId).sort();
    expect(started).toEqual([eligible, deadRunning].sort());
    expect(startMock.mock.calls[0][0]).toMatchObject({ organizationId: t.orgId, projectId: t.projectId, origin: "auto" });
    expect(await runRows(noRun)).toHaveLength(0);

    // The retry runs (its row now counts as a second automatic run), then dies stale too: never picked again.
    for (const id of [eligible, deadRunning]) {
      await mockDatabase.update(schema.sreInvestigationRuns).set({ status: "failed", startedAt: minutesAgo(30), agentStateSnapshot: { errorCode: "stale_run" } }).where(eq(schema.sreInvestigationRuns.incidentId, id));
    }
    startMock.mockClear();
    expect(await retriageStaleRuns()).toBe(0);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("skips incidents that already have a completed run or a live running one", async () => {
    const t = await tenant();
    const completedManual = await incident(t, { withAlert: false });
    await staleAuto(t, completedManual);
    await run(t, completedManual, { origin: "manual", status: "completed" });
    const liveManual = await incident(t, { withAlert: false });
    await staleAuto(t, liveManual);
    await run(t, liveManual, { origin: "manual", status: "running", startedMinutesAgo: 1 });
    expect(await retriageStaleRuns()).toBe(0);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("stays scoped to the incident's own organization and project", async () => {
    const a = await tenant();
    const b = await tenant();
    const aId = await incident(a, { withAlert: false });
    await staleAuto(a, aId);
    const bId = await incident(b, { withAlert: false });
    await staleAuto(b, bId);
    await retriageStaleRuns();
    const calls = startMock.mock.calls.map(([input]) => [input.incidentId, input.organizationId]);
    expect(calls).toEqual(expect.arrayContaining([[aId, a.orgId], [bId, b.orgId]]));
  });

  it("starts nothing when automation is off or the AI provider is not configured", async () => {
    const t = await tenant();
    const id = await incident(t, { withAlert: false });
    await staleAuto(t, id);
    delete process.env.SRE_AUTOMATION_ENABLED;
    expect(await retriageStaleRuns()).toBe(0);
    process.env.SRE_AUTOMATION_ENABLED = "true";
    (validateAIConfiguration as jest.Mock).mockImplementation(() => {
      throw new Error("no key");
    });
    expect(await retriageStaleRuns()).toBe(0);
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe("sweepSreIncidents", () => {
  it("runs both branches end to end", async () => {
    const t = await tenant();
    await setMonitor(t, "up", 10);
    const recovered = await incident(t, { alertMinutesAgo: 30 });
    const retry = await incident(t, { withAlert: false });
    await staleAuto(t, retry);
    expect(await sweepSreIncidents()).toEqual({ reconciled: 1, retriaged: 1 });
    expect((await statusOf(recovered))[recovered]).toBe("resolved");
  });

  it("is off when SRE is disabled", async () => {
    process.env.SRE_ENABLED = "false";
    expect(await sweepSreIncidents()).toEqual({ skipped: "disabled" });
  });

  it("skips the tick while another replica holds the lock", async () => {
    const t = await tenant();
    await setMonitor(t, "up", 10);
    const id = await incident(t, { alertMinutesAgo: 30 });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    const other = client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(7311, hashtext('sre-incident-sweep'))`;
      acquired();
      await held;
    });
    await ready;
    try {
      expect(await sweepSreIncidents()).toEqual({ skipped: "locked" });
      expect((await statusOf(id))[id]).toBe("triggered");
    } finally {
      release();
      await other;
    }
    expect(await sweepSreIncidents()).toEqual({ reconciled: 1, retriaged: 0 });
  });
});

// Runs the candidate SELECTs of a sweep through EXPLAIN on a table shape like production: many incidents, most
// resolved or old, 60k investigation runs, a few hundred open recent ones. Set SWEEP_EXPLAIN=1 to print the plans.
it("candidate queries reach investigation runs only through an index", async () => {
  const t = await tenant();
  await client.unsafe(`
    INSERT INTO sre_incidents (id, incident_number, organization_id, project_id, title, severity, status, alert_count, last_alert_at, created_at, updated_at)
    SELECT gen_random_uuid(), 100000 + g, '${t.orgId}', '${t.projectId}', 't', 'sev2',
      CASE WHEN g % 20 = 0 THEN 'triggered' ELSE 'resolved' END, 1, now() - interval '1 hour',
      CASE WHEN g % 20 = 0 AND g % 40 <> 0 THEN now() - interval '1 hour' ELSE now() - interval '10 days' END, now()
    FROM generate_series(1, 20000) g`);
  await client.unsafe(`
    INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, dedup_key, severity, status, source_type, source_id, title, fired_at)
    SELECT gen_random_uuid(), '${t.orgId}', '${t.projectId}', md5(i.id::text) || md5(i.id::text), '${t.projectId}:monitor:${t.monitorId}:monitor_failure', 'sev2', 'firing', 'monitor', '${t.monitorId}', 'API: Monitor down', now() - interval '1 hour'
    FROM sre_incidents i WHERE i.incident_number > 100000 AND i.status = 'triggered'`);
  await client.unsafe(`INSERT INTO sre_incident_alerts (id, incident_id, alert_event_id, role) SELECT gen_random_uuid(), i.id, e.id, 'trigger' FROM sre_incidents i JOIN sre_alert_events e ON e.fingerprint_hash = md5(i.id::text) || md5(i.id::text)`);
  // Three runs per incident (60k): a stale automatic run for the open ones, so they are real candidates.
  await client.unsafe(`
    INSERT INTO sre_investigation_runs (id, organization_id, project_id, incident_id, agent_type, status, model_id, origin, started_at, agent_state_snapshot)
    SELECT gen_random_uuid(), i.organization_id, i.project_id, i.id, 'triage',
      CASE WHEN n = 1 AND i.status = 'triggered' THEN 'failed' ELSE 'completed' END, 'm',
      CASE WHEN n = 1 THEN 'auto' ELSE 'manual' END, now() - interval '1 hour',
      CASE WHEN n = 1 AND i.status = 'triggered' THEN '{"errorCode":"stale_run"}'::jsonb END
    FROM sre_incidents i CROSS JOIN generate_series(1, 3) n
    WHERE i.incident_number > 100000 AND (i.status = 'resolved' OR n = 1)`);
  await client.unsafe(`
    INSERT INTO sre_investigation_runs (id, organization_id, project_id, incident_id, agent_type, status, model_id, origin, started_at)
    SELECT gen_random_uuid(), i.organization_id, i.project_id, i.id, 'triage', 'completed', 'm', 'manual', now() - interval '2 hours'
    FROM sre_incidents i CROSS JOIN generate_series(1, 2) n WHERE i.incident_number > 100000 AND i.status = 'resolved'`);
  await client.unsafe("ANALYZE");
  const [{ runCount }] = await client`SELECT count(*)::int AS "runCount" FROM sre_investigation_runs`;
  expect(runCount).toBeGreaterThan(50_000);
  captured.length = 0;
  // The monitor is still down, so the recovery branch leaves the open incidents for the re-triage branch to see.
  await sweepSreIncidents();
  await setMonitor(t, "up", 10);
  const selects = captured.filter(({ query }) => /^\s*select/i.test(query) && /sre_incidents/.test(query) && /random\(\)/i.test(query));
  expect(selects.length).toBe(3);
  for (const { query, params } of selects) {
    const plan = (await client.unsafe(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${query}`, params as never[])).map((row) => String(row["QUERY PLAN"])).join("\n");
    if (process.env.SWEEP_EXPLAIN) console.log(`${query.trim().slice(0, 80)}...\n${plan}`);
    expect(plan).not.toMatch(/Seq Scan on sre_investigation_runs/);
  }
});
