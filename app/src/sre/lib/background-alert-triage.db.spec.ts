/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn(async () => undefined) }));
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ sreDailyTokenLimitResponse: jest.fn(async () => null) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(async () => undefined) }));
jest.mock("@/sre/lib/triage-runner", () => ({ startSreIncidentTriage: jest.fn(), completeSreIncidentTriage: jest.fn() }));
jest.mock("@/lib/ai/ai-provider", () => ({ validateAIConfiguration: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: () => false }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));

import { processSreBackgroundAlertTriageJob, recordTriageSkipped } from "./background-alert-triage";
import { GET as getAlertHistory } from "@/app/api/alerts/history/route";
import { requireAuthContext } from "@/lib/auth-context";
import { resolveIncident } from "@/lib/sre/incident-lifecycle";
import { linkedAlertFields } from "@/lib/sre/incident-alert-snapshot";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { startSreIncidentTriage } from "@/sre/lib/triage-runner";

const execFileAsync = promisify(execFile);
const name = `alert_incidents_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;
let projectId: string;
let userId: string;
let monitorId: string;
let jobId: string;

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
  delete process.env.SRE_AUTOMATION_ENABLED;
  delete process.env.SRE_ENABLED;
  await client`TRUNCATE organization, "user" CASCADE`;
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  orgId = organization.id;
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: orgId, name: "P" }).returning();
  projectId = project.id;
  const [person] = await mockDatabase.insert(schema.user).values({ name: "Owner", email: `${randomUUID()}@example.com` }).returning();
  userId = person.id;
  const [monitor] = await mockDatabase
    .insert(schema.monitors)
    .values({ organizationId: orgId, projectId, name: "Checkout API", type: "http_request", target: "https://example.com", status: "down" })
    .returning();
  monitorId = monitor.id;
  const [job] = await mockDatabase
    .insert(schema.jobs)
    .values({ organizationId: orgId, projectId, name: "Nightly export", cronSchedule: null, status: "failed" } as never)
    .returning();
  jobId = job.id;
});

// Alert times are anchored 20 minutes in the past so that person-made changes (stamped with
// the real clock) fall between them, as they would in production.
const base = Date.now() - 20 * 60_000;
const minutes = (n: number) => new Date(base + n * 60_000);

async function alert(
  type: string,
  at: Date,
  opts: { status?: "sent" | "failed" | "pending"; job?: boolean; provider?: string; dedupKey?: string; message?: string } = {},
) {
  const [row] = await mockDatabase
    .insert(schema.alertHistory)
    .values({
      message: opts.message ?? `${type} message`,
      type: type as never,
      target: opts.job ? "Nightly export" : "Checkout API",
      targetType: opts.job ? "job" : "monitor",
      monitorId: opts.job ? null : monitorId,
      jobId: opts.job ? jobId : null,
      provider: opts.provider ?? "slack",
      status: opts.status ?? "sent",
      deliveryMetadata: opts.dedupKey ? ({ version: 1, correlation: { dedupKey: opts.dedupKey } } as never) : null,
      sentAt: at,
    })
    .returning();
  return processSreBackgroundAlertTriageJob({ alertHistoryId: row.id });
}

async function incidents() {
  return mockDatabase
    .select({
      id: schema.sreIncidents.id,
      number: schema.sreIncidents.incidentNumber,
      status: schema.sreIncidents.status,
      severity: schema.sreIncidents.severity,
      resolvedAt: schema.sreIncidents.resolvedAt,
      resolutionSummary: schema.sreIncidents.resolutionSummary,
      acknowledgedAt: schema.sreIncidents.acknowledgedAt,
    })
    .from(schema.sreIncidents)
    .where(eq(schema.sreIncidents.organizationId, orgId))
    .orderBy(asc(schema.sreIncidents.incidentNumber));
}

async function states(incidentId: string) {
  const rows = await mockDatabase
    .select({ data: schema.sreIncidentTimelineEvents.eventData })
    .from(schema.sreIncidentTimelineEvents)
    .where(and(eq(schema.sreIncidentTimelineEvents.incidentId, incidentId), eq(schema.sreIncidentTimelineEvents.eventType, "state_change")))
    .orderBy(asc(schema.sreIncidentTimelineEvents.createdAt));
  return rows.map((row) => (row.data as { state?: string }).state);
}

it("opens one incident per failing monitor without AI, and dedups repeats", async () => {
  expect(await alert("monitor_failure", minutes(0))).toMatchObject({ success: true, skipped: true, reason: "ai_disabled" });
  await alert("monitor_failure", minutes(5));
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("triggered");
});

it("opens an incident even when the alert delivery failed, but not for pending rows", async () => {
  await alert("monitor_failure", minutes(0), { status: "pending" });
  expect(await incidents()).toHaveLength(0);
  await alert("monitor_failure", minutes(1), { status: "failed" });
  expect(await incidents()).toHaveLength(1);
});

it("auto-resolves an unacknowledged incident on recovery and reopens it on a quick relapse", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_recovery", minutes(10));
  let [row] = await incidents();
  expect(row.status).toBe("resolved");
  expect(row.resolutionSummary).toMatch(/Recovered automatically/);
  expect(jest.mocked(notifyIncidentEvent)).toHaveBeenCalledWith(expect.objectContaining({ event: "resolved", automatic: true }));

  await alert("monitor_failure", minutes(20));
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  [row] = rows;
  expect(row.status).toBe("triggered");
  expect(row.resolvedAt).toBeNull();
  expect(await states(row.id)).toContain("reopened");
});

it("opens a new incident when the relapse comes after the reopen window", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_recovery", minutes(10));
  await alert("monitor_failure", minutes(10 + 31));
  const rows = await incidents();
  expect(rows.map((r) => r.status)).toEqual(["resolved", "triggered"]);
});

it("leaves an acknowledged incident open on recovery with a single recovered note", async () => {
  await alert("monitor_failure", minutes(0));
  const [open] = await incidents();
  await mockDatabase.update(schema.sreIncidents).set({ acknowledgedAt: minutes(1), acknowledgedByUserId: userId, assigneeUserId: userId }).where(eq(schema.sreIncidents.id, open.id));
  await alert("monitor_recovery", minutes(10));
  await alert("monitor_recovery", minutes(11));
  const [row] = await incidents();
  expect(row.status).toBe("triggered");
  expect((await states(row.id)).filter((s) => s === "recovered")).toHaveLength(1);
});

it("notes a failure that returns on an acknowledged incident, then notes the next recovery again", async () => {
  await alert("monitor_failure", minutes(0));
  const [open] = await incidents();
  await mockDatabase.update(schema.sreIncidents).set({ acknowledgedAt: minutes(1), acknowledgedByUserId: userId }).where(eq(schema.sreIncidents.id, open.id));
  await alert("monitor_recovery", minutes(10));
  // A person acting after the recovery must not hide the returning failure.
  await mockDatabase.insert(schema.sreIncidentTimelineEvents).values({ incidentId: open.id, eventType: "state_change", eventData: { state: "assigned" }, actorType: "user", createdAt: new Date() });
  await alert("monitor_failure", minutes(12));
  await alert("monitor_recovery", minutes(14));
  expect((await states(open.id)).slice(1)).toEqual(["recovered", "assigned", "failure_returned", "recovered"]);
});

it("does not reopen on a failure that fired before the automatic recovery", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_recovery", minutes(10));
  await alert("job_failed", minutes(9), { job: false });
  const rows = await incidents();
  // Joined to the incident it belongs to: no reopen and no duplicate incident.
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("resolved");
  expect(await states(rows[0].id)).not.toContain("reopened");
});

it("does not note a failure as returned when it fired before the recovery", async () => {
  await alert("monitor_failure", minutes(0));
  const [open] = await incidents();
  await mockDatabase.update(schema.sreIncidents).set({ acknowledgedAt: minutes(1), acknowledgedByUserId: userId }).where(eq(schema.sreIncidents.id, open.id));
  await alert("monitor_recovery", minutes(10));
  await alert("job_failed", minutes(8), { job: false });
  expect(await states(open.id)).not.toContain("failure_returned");
});

it("keeps each incident's alert as it was when linked, after later failures reuse the alert row", async () => {
  await alert("monitor_failure", minutes(0), { message: "first: 502 from checkout" });
  await alert("monitor_recovery", minutes(5));
  await alert("monitor_failure", minutes(5 + 31), { message: "second: DNS timeout" });
  const [first, second] = await incidents();
  const linked = async (incidentId: string) =>
    mockDatabase
      .select({ description: linkedAlertFields.description, firedAt: linkedAlertFields.firedAt })
      .from(schema.sreIncidentAlerts)
      .innerJoin(schema.sreAlertEvents, eq(schema.sreAlertEvents.id, schema.sreIncidentAlerts.alertEventId))
      .where(eq(schema.sreIncidentAlerts.incidentId, incidentId));
  expect(await linked(first.id)).toEqual([{ description: "first: 502 from checkout", firedAt: minutes(0) }]);
  expect(await linked(second.id)).toEqual([{ description: "second: DNS timeout", firedAt: minutes(36) }]);
});

it("does not reopen an incident a person resolved, even within the window", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_recovery", minutes(5));
  await alert("monitor_failure", minutes(8)); // reopened
  const [reopened] = await incidents();
  const resolved = await resolveIncident({ organizationId: orgId, projectId, userId }, reopened.id, "Fixed the deploy");
  expect(resolved.ok).toBe(true);
  await alert("monitor_failure", minutes(25)); // after the person's resolve, inside the 30 min window
  const rows = await incidents();
  expect(rows.map((r) => r.status)).toEqual(["resolved", "triggered"]);
});

it("ignores a recovery that is older than the latest failure", async () => {
  await alert("monitor_failure", minutes(0));
  // Failure at 12 is processed before the (older) recovery at 10.
  await alert("monitor_failure", minutes(12));
  await alert("monitor_recovery", minutes(10));
  const [row] = await incidents();
  expect(row.status).toBe("triggered");
});

const sourceRecovery = (at: Date, job = false) =>
  processSreBackgroundAlertTriageJob({
    sourceRecovery: { sourceType: job ? "job" : "monitor", sourceId: job ? jobId : monitorId, recoveredAt: at.toISOString() },
  });

it("auto-resolves on a worker recovery signal with no recovery alert recorded", async () => {
  await alert("monitor_failure", minutes(0));
  expect(await sourceRecovery(minutes(5))).toEqual({ success: true, skipped: true, reason: "recovery_handled" });
  const [row] = await incidents();
  expect(row.status).toBe("resolved");
  // A recovery alert for the same recovery afterwards changes nothing.
  await alert("monitor_recovery", minutes(5));
  expect(await incidents()).toHaveLength(1);
});

it("ignores a worker recovery signal older than the latest failure", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_failure", minutes(12));
  await sourceRecovery(minutes(10));
  const [row] = await incidents();
  expect(row.status).toBe("triggered");
});

const sourceFailure = (at: Date) =>
  processSreBackgroundAlertTriageJob({
    sourceFailure: { sourceType: "monitor", sourceId: monitorId, type: "monitor_failure", message: "down", firedAt: at.toISOString() },
  });
const makeIncidentOnly = () =>
  mockDatabase
    .update(schema.monitors)
    .set({ alertConfig: { enabled: false, incidentEnabled: true } as never })
    .where(eq(schema.monitors.id, monitorId));

it("a newer incident-only failure blocks an older recovery", async () => {
  await makeIncidentOnly();
  await sourceFailure(minutes(0));
  await sourceFailure(minutes(12)); // no alert_history row for either
  await sourceRecovery(minutes(10));
  const [row] = await incidents();
  expect(row.status).toBe("triggered");
  // A recovery after the latest failure still resolves it.
  await sourceRecovery(minutes(14));
  expect((await incidents())[0].status).toBe("resolved");
});

it("another source's newer failure does not block this source's recovery", async () => {
  await makeIncidentOnly();
  await sourceFailure(minutes(0));
  await alert("job_failed", minutes(12), { job: true }); // a different source fires after the recovery time
  await sourceRecovery(minutes(10));
  const rows = await incidents();
  expect(rows[0].status).toBe("resolved");
});

it("records and resolves a failure processed after the monitor already recovered", async () => {
  // A retry or a queue backlog: the monitor was back up at 5 before the failure from 0 is processed.
  await mockDatabase.update(schema.monitors).set({ status: "up", lastStatusChangeAt: minutes(5) }).where(eq(schema.monitors.id, monitorId));
  expect(await alert("monitor_failure", minutes(0))).toEqual({ success: true, skipped: true, reason: "recovered_before_triage" });
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("resolved");
});

it("keeps a failure open when the monitor went up only before it fired", async () => {
  await mockDatabase.update(schema.monitors).set({ status: "up", lastStatusChangeAt: minutes(-5) }).where(eq(schema.monitors.id, monitorId));
  await alert("monitor_failure", minutes(0));
  const [row] = await incidents();
  expect(row.status).toBe("triggered");
});

it("resolves a job failure processed after a later passing run, and job recovery signals", async () => {
  await mockDatabase.insert(schema.runs).values({ jobId, projectId, status: "passed", completedAt: minutes(6) } as never);
  await alert("job_failed", minutes(0), { job: true });
  expect((await incidents())[0].status).toBe("resolved");

  await alert("job_failed", minutes(60), { job: true });
  await sourceRecovery(minutes(70), true);
  const rows = await incidents();
  expect(rows.at(-1)!.status).toBe("resolved");
});

it("alert history links each alert to the incident it belonged to", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_recovery", minutes(5));
  await alert("monitor_failure", minutes(70)); // after the reopen window: a new incident
  jest.mocked(requireAuthContext).mockResolvedValue({ organizationId: orgId, project: { id: projectId } } as never);
  const response = await getAlertHistory(new Request("http://localhost/api/alerts/history") as never);
  const rows = (await response.json()) as Array<{ type: string; timestamp: string; incident: { number: number } | null }>;
  const [first, second] = await incidents();
  const byTime = rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  expect(byTime.map((row) => [row.type, row.incident?.number ?? null])).toEqual([
    ["monitor_failure", first.number],
    ["monitor_recovery", first.number],
    ["monitor_failure", second.number],
  ]);
});

it("alert history does not link alerts to unrelated or later incidents", async () => {
  // An SSL alert never belongs to an up/down incident, and an old alert with no incident stays unlinked.
  await mockDatabase.update(schema.monitors).set({ alertConfig: { enabled: true, notificationProviders: [], alertOnFailure: true, failureThreshold: 1, recoveryThreshold: 1, incidentEnabled: false } }).where(eq(schema.monitors.id, monitorId));
  await alert("monitor_failure", new Date(base - 3 * 60 * 60_000));
  await mockDatabase.update(schema.monitors).set({ alertConfig: null }).where(eq(schema.monitors.id, monitorId));
  await alert("monitor_failure", minutes(0));
  await mockDatabase.insert(schema.alertHistory).values({ message: "ssl", type: "ssl_expiring", target: "Checkout API", targetType: "monitor", monitorId, provider: "slack", status: "sent", sentAt: minutes(1) });
  jest.mocked(requireAuthContext).mockResolvedValue({ organizationId: orgId, project: { id: projectId } } as never);
  const rows = (await (await getAlertHistory(new Request("http://localhost/api/alerts/history") as never)).json()) as Array<{ type: string; timestamp: string; incident: { number: number } | null }>;
  const [only] = await incidents();
  expect(rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map((row) => [row.type, row.incident?.number ?? null])).toEqual([
    ["monitor_failure", null],
    ["monitor_failure", only.number],
    ["ssl_expiring", null],
  ]);
});

describe("a late failure with a recovery threshold above 1 (INC-4)", () => {
  const threshold = (recoveryThreshold: number) => ({ enabled: true, notificationProviders: [], alertOnFailure: true, failureThreshold: 1, recoveryThreshold });
  const passes = (count: number) =>
    mockDatabase.insert(schema.monitorResults).values({ monitorId, checkedAt: minutes(6), status: "up", isUp: true, consecutiveSuccessCount: count });

  it("stays open until the monitor passed the threshold in a row", async () => {
    await mockDatabase.update(schema.monitors).set({ status: "up", lastStatusChangeAt: minutes(5), alertConfig: threshold(3) }).where(eq(schema.monitors.id, monitorId));
    await passes(2);
    await alert("monitor_failure", minutes(0));
    expect((await incidents())[0].status).toBe("triggered");
  });

  it("resolves once the monitor passed the threshold in a row, since the signal was already spent", async () => {
    await mockDatabase.update(schema.monitors).set({ status: "up", lastStatusChangeAt: minutes(5), alertConfig: threshold(3) }).where(eq(schema.monitors.id, monitorId));
    await passes(3);
    expect(await alert("monitor_failure", minutes(0))).toMatchObject({ skipped: true, reason: "recovered_before_triage" });
    expect((await incidents())[0].status).toBe("resolved");
  });

  it("reads a multi-location monitor's aggregated pass count, bounded by the check cycles since it came up", async () => {
    const config = (count: number) => ({ locationConfig: { enabled: true, locations: ["us-east", "eu-central"] }, aggregatedAlertState: { consecutiveSuccessCount: count } }) as never;
    const cycle = (group: string, at: Date) =>
      mockDatabase.insert(schema.monitorResults).values(
        (["us-east", "eu-central"] as const).map((location) => ({ monitorId, location, executionGroupId: group, checkedAt: at, status: "up" as const, isUp: true, consecutiveSuccessCount: 5 })),
      );
    await mockDatabase.update(schema.monitors).set({ status: "up", lastStatusChangeAt: minutes(5), alertConfig: threshold(2), config: config(1) }).where(eq(schema.monitors.id, monitorId));
    await cycle("g1", minutes(5)); // a per-location row's own count does not count for a multi-location monitor
    await alert("monitor_failure", minutes(0));
    expect((await incidents())[0].status).toBe("triggered");
    // A count kept from before this recovery (10) is bounded by the one cycle run since the monitor came up.
    await mockDatabase.update(schema.monitors).set({ config: config(10) }).where(eq(schema.monitors.id, monitorId));
    await alert("monitor_failure", minutes(1));
    expect((await incidents())[0].status).toBe("triggered");
    await cycle("g2", minutes(6));
    await alert("monitor_failure", minutes(2));
    expect((await incidents())[0].status).toBe("resolved");
  });

  it("resolves a job only when its last N runs since the failure all passed", async () => {
    await mockDatabase.update(schema.jobs).set({ alertConfig: threshold(2) } as never).where(eq(schema.jobs.id, jobId));
    await mockDatabase.insert(schema.runs).values({ jobId, projectId, status: "passed", completedAt: minutes(6) } as never);
    await alert("job_failed", minutes(0), { job: true });
    expect((await incidents())[0].status).toBe("triggered");
    await mockDatabase.insert(schema.runs).values({ jobId, projectId, status: "passed", completedAt: minutes(7) } as never);
    await alert("job_failed", minutes(1), { job: true });
    expect((await incidents())[0].status).toBe("resolved");
  });
});

it("never triages a resolved incident when a deferred failure job is retried after the resolve (INC-2)", async () => {
  process.env.SRE_AUTOMATION_ENABLED = "true";
  jest.mocked(startSreIncidentTriage).mockResolvedValue({ success: false, status: 409, reason: "org_concurrency_limit", error: "busy" } as never);
  const [row] = await mockDatabase
    .insert(schema.alertHistory)
    .values({ message: "down", type: "monitor_failure", target: "Checkout API", targetType: "monitor", monitorId, provider: "slack", status: "sent", sentAt: minutes(0) })
    .returning();
  expect(await processSreBackgroundAlertTriageJob({ alertHistoryId: row.id })).toMatchObject({ skipped: true, reason: "org_concurrency_limit" });
  await alert("monitor_recovery", minutes(5));
  const before = await mockDatabase.select().from(schema.sreIncidents).where(eq(schema.sreIncidents.organizationId, orgId));
  const timelineBefore = await states(before[0].id);

  expect(await processSreBackgroundAlertTriageJob({ alertHistoryId: row.id })).toMatchObject({ skipped: true, reason: "resolved_incident" });
  expect(startSreIncidentTriage).toHaveBeenCalledTimes(1);
  const after = await mockDatabase.select().from(schema.sreIncidents).where(eq(schema.sreIncidents.organizationId, orgId));
  expect(after).toEqual(before);
  expect(await states(before[0].id)).toEqual(timelineBefore);
});

it("skips a queued failure for a paused or disabled monitor, but still resolves on its recovery (INC-3)", async () => {
  await alert("monitor_failure", minutes(0));
  await mockDatabase.update(schema.monitors).set({ status: "paused" }).where(eq(schema.monitors.id, monitorId));
  expect(await alert("monitor_failure", minutes(2))).toMatchObject({ skipped: true, reason: "source_paused" });
  await alert("monitor_recovery", minutes(5));
  expect((await incidents()).map((r) => r.status)).toEqual(["resolved"]);

  await mockDatabase.update(schema.monitors).set({ status: "down", enabled: false }).where(eq(schema.monitors.id, monitorId));
  expect(await alert("monitor_failure", minutes(60))).toMatchObject({ skipped: true, reason: "source_paused" });
  expect(await incidents()).toHaveLength(1);
});

it("sets severity by alert type only, and raises it when a more severe alert joins (INC-8)", async () => {
  await alert("job_failed", minutes(0), { job: true, message: "a critical sev1 export failed" });
  const [opened] = await incidents();
  expect(opened.severity).toBe("sev2");
  await alert("job_timeout", minutes(2), { job: true });
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0].severity).toBe("sev1");
  const edits = await mockDatabase
    .select({ data: schema.sreIncidentTimelineEvents.eventData, actor: schema.sreIncidentTimelineEvents.actorType })
    .from(schema.sreIncidentTimelineEvents)
    .where(eq(schema.sreIncidentTimelineEvents.incidentId, opened.id));
  expect(edits.filter((e) => (e.data as { state?: string }).state === "incident_updated")).toEqual([
    { actor: "system", data: expect.objectContaining({ previous: { severity: "sev2" }, current: { severity: "sev1" } }) },
  ]);
  // A less severe alert never lowers it.
  await alert("job_failed", minutes(4), { job: true });
  expect((await incidents())[0].severity).toBe("sev1");
});

it("counts alerts and measures the outage per open period after a reopen (INC-9)", async () => {
  await alert("monitor_failure", minutes(0));
  await alert("monitor_failure", minutes(2));
  await alert("monitor_recovery", minutes(10));
  const [first] = await incidents();
  // The first open period started long ago.
  await mockDatabase.update(schema.sreIncidents).set({ createdAt: new Date(base - 3 * 60 * 60_000) }).where(eq(schema.sreIncidents.id, first.id));
  await alert("monitor_failure", minutes(20));
  const alertCount = async () =>
    (await mockDatabase.select({ alertCount: schema.sreIncidents.alertCount }).from(schema.sreIncidents).where(eq(schema.sreIncidents.id, first.id)))[0].alertCount;
  expect(await alertCount()).toBe(1);
  // A late failure from the closed period does not count in the new one; a new failure does.
  await alert("monitor_failure", minutes(1));
  expect(await alertCount()).toBe(1);
  await alert("monitor_failure", minutes(22));
  expect(await alertCount()).toBe(2);
  await alert("monitor_recovery", minutes(30));
  const [row] = await incidents();
  expect(row.status).toBe("resolved");
  expect(row.resolutionSummary).not.toMatch(/\dh/);
});

it("never auto-resolves an SSL expiry incident from an up/down recovery", async () => {
  await alert("ssl_expiring", minutes(0));
  await alert("monitor_recovery", minutes(5));
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0].status).not.toBe("resolved");
});

it("respects the monitor's incident settings", async () => {
  await mockDatabase
    .update(schema.monitors)
    .set({ alertConfig: { enabled: true, notificationProviders: [], alertOnFailure: true, failureThreshold: 1, recoveryThreshold: 1, incidentEnabled: false } })
    .where(eq(schema.monitors.id, monitorId));
  expect(await alert("monitor_failure", minutes(0))).toMatchObject({ skipped: true, reason: "incident_disabled" });
  expect(await incidents()).toHaveLength(0);

  await mockDatabase
    .update(schema.monitors)
    .set({ alertConfig: { enabled: true, notificationProviders: [], alertOnFailure: true, failureThreshold: 1, recoveryThreshold: 1, incidentSeverity: "sev1", autoResolveIncident: false } })
    .where(eq(schema.monitors.id, monitorId));
  await alert("monitor_failure", minutes(1));
  await alert("monitor_recovery", minutes(5));
  const [row] = await incidents();
  expect(row.severity).toBe("sev1");
  expect(row.status).toBe("triggered");
  expect(await states(row.id)).toContain("recovered");
});

it("drops a monitor failure that fired inside a maintenance window, judged at its fire time", async () => {
  // Project-wide window from minute 2 until after now, so every alert below is processed while it is active.
  await client`INSERT INTO maintenance_windows (id, organization_id, project_id, title, scope, recurrence, timezone, local_start_time, duration_minutes, starts_on, occurrence_starts_at, occurrence_ends_at)
    VALUES (uuidv7(), ${orgId}, ${projectId}, 'Deploy', 'project', 'once', 'UTC', '00:00', 60, '2026-01-01', ${minutes(2).toISOString()}::timestamptz, now() + interval '10 minutes')`;

  expect(await alert("monitor_failure", minutes(5))).toMatchObject({ success: true, skipped: true, reason: "in_maintenance" });
  expect(await incidents()).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.sreAlertEvents).where(eq(schema.sreAlertEvents.organizationId, orgId))).toHaveLength(0);

  // Fired before the window opened and handled late: still opens its incident.
  await alert("monitor_failure", minutes(0));
  expect(await incidents()).toMatchObject([{ status: "triggered" }]);

  // A recovery inside the window still resolves it.
  await alert("monitor_recovery", minutes(8));
  expect(await incidents()).toMatchObject([{ status: "resolved" }]);

  // Job failures are not covered by monitor maintenance.
  await alert("job_failed", minutes(9), { job: true });
  expect(await incidents()).toHaveLength(2);
});

it("opens and auto-resolves job incidents", async () => {
  await alert("job_failed", minutes(0), { job: true });
  await alert("job_success", minutes(30), { job: true });
  const [row] = await incidents();
  expect(row.status).toBe("resolved");
});

it("links a new monitor incident to the open automatic status update for its component", async () => {
  const [page] = await mockDatabase
    .insert(schema.statusPages)
    .values({ organizationId: orgId, projectId, name: "Status", subdomain: randomUUID().replaceAll("-", ""), status: "published" })
    .returning();
  const [component] = await mockDatabase.insert(schema.statusPageComponents).values({ statusPageId: page.id, name: "Checkout" }).returning();
  await mockDatabase.insert(schema.statusPageComponentMonitors).values({ componentId: component.id, monitorId });
  const [statusIncident] = await mockDatabase
    .insert(schema.incidents)
    .values({ statusPageId: page.id, name: "Checkout down", status: "investigating", impact: "major", sourceComponentId: component.id } as never)
    .returning();

  await alert("monitor_failure", minutes(0));
  const [row] = await incidents();
  const [sre] = await mockDatabase.select({ link: schema.sreIncidents.statusPageIncidentId }).from(schema.sreIncidents).where(eq(schema.sreIncidents.id, row.id));
  const [pub] = await mockDatabase.select({ link: schema.incidents.sreIncidentId }).from(schema.incidents).where(eq(schema.incidents.id, statusIncident.id));
  expect(sre.link).toBe(statusIncident.id);
  expect(pub.link).toBe(row.id);
});

it("opens one incident when a failure is delivered to several channels", async () => {
  await alert("monitor_failure", minutes(0), { provider: "slack" });
  // Webhook deliveries carry a channel correlation key without the alert type.
  await alert("monitor_failure", minutes(0), { provider: "webhook", dedupKey: `monitor:${monitorId}` });
  expect(await incidents()).toHaveLength(1);
  await alert("monitor_recovery", minutes(5), { provider: "webhook", dedupKey: `monitor:${monitorId}` });
  expect((await incidents()).map((r) => r.status)).toEqual(["resolved"]);
});

it("joins an incident opened under the old webhook identity instead of opening a second one", async () => {
  // Seed an open incident created before identities moved to source + type.
  const [incident] = await mockDatabase
    .insert(schema.sreIncidents)
    .values({ organizationId: orgId, projectId, incidentNumber: 1, title: "Checkout API: Monitor Failure", severity: "sev2", status: "triggered", acknowledgedAt: minutes(1) })
    .returning();
  const [legacyEvent] = await mockDatabase
    .insert(schema.sreAlertEvents)
    .values({
      organizationId: orgId,
      projectId,
      fingerprintHash: randomUUID(),
      dedupKey: `monitor:${monitorId}`,
      severity: "sev2",
      status: "firing",
      sourceType: "monitor",
      sourceId: monitorId,
      title: "Checkout API: Monitor Failure",
      firedAt: minutes(0),
    })
    .returning();
  await mockDatabase.insert(schema.sreIncidentAlerts).values({ incidentId: incident.id, alertEventId: legacyEvent.id, role: "trigger" });

  await alert("monitor_failure", minutes(5));
  expect(await incidents()).toHaveLength(1);

  // Acknowledged, so recovery leaves a note; it must still find the legacy incident by title.
  await alert("monitor_recovery", minutes(10));
  expect(await states(incident.id)).toContain("recovered");
});

it("resolves the firing alert events on recovery so the service firing count falls", async () => {
  const firing = () =>
    mockDatabase
      .select({ status: schema.sreAlertEvents.status, resolvedAt: schema.sreAlertEvents.resolvedAt })
      .from(schema.sreAlertEvents)
      .where(eq(schema.sreAlertEvents.organizationId, orgId));
  await alert("monitor_failure", minutes(0));
  expect((await firing()).map((r) => r.status)).toEqual(["firing"]);
  await alert("monitor_recovery", minutes(10));
  const [row] = await firing();
  expect(row.status).toBe("resolved");
  expect(row.resolvedAt).toEqual(minutes(10));
  // A relapse re-fires the same event.
  await alert("monitor_failure", minutes(12));
  expect((await firing()).map((r) => r.status)).toEqual(["firing"]);
});

it("leaves the alert firing when the recovery is older than the latest failure", async () => {
  await alert("monitor_failure", minutes(12));
  await alert("monitor_recovery", minutes(10));
  const rows = await mockDatabase.select({ status: schema.sreAlertEvents.status }).from(schema.sreAlertEvents);
  expect(rows.map((r) => r.status)).toEqual(["firing"]);
});

it("records a skipped AI triage once per open period, also when two writers race (INC-6)", async () => {
  await alert("monitor_failure", minutes(0));
  const [row] = await incidents();
  const skips = async () => (await states(row.id)).filter((state) => state === "triage_skipped");
  await Promise.all([recordTriageSkipped(row.id, "daily_limit"), recordTriageSkipped(row.id, "daily_limit")]);
  await recordTriageSkipped(row.id, "ai_not_configured");
  expect(await skips()).toHaveLength(1);
  // A reopened incident is a new open period: it says why it got no triage either.
  await mockDatabase.update(schema.sreIncidents).set({ reopenedAt: new Date(Date.now() + 1000) }).where(eq(schema.sreIncidents.id, row.id));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await recordTriageSkipped(row.id, "daily_limit");
  expect(await skips()).toHaveLength(2);
});

it("raises severity when a more severe failure reopens an incident (INC-8)", async () => {
  await alert("job_failed", minutes(0), { job: true });
  await alert("job_success", minutes(10), { job: true });
  expect((await incidents())[0]).toMatchObject({ status: "resolved", severity: "sev2" });
  await alert("job_timeout", minutes(15), { job: true });
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "triggered", severity: "sev1" });
});

it("raises a declared incident's severity when a more severe alert of a listed monitor joins it (INC-8)", async () => {
  const [declared] = await mockDatabase
    .insert(schema.sreIncidents)
    .values({ organizationId: orgId, projectId, incidentNumber: 1, title: "Checkout slow", severity: "sev3", status: "triggered", createdByUserId: userId })
    .returning();
  await mockDatabase.insert(schema.sreIncidentResources).values({ incidentId: declared.id, resourceType: "monitor", resourceId: monitorId } as never);
  await alert("monitor_failure", minutes(0));
  const rows = await incidents();
  expect(rows).toHaveLength(1);
  expect(rows[0].severity).toBe("sev2");
});
