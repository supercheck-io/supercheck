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
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(async () => undefined) }));
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: jest.fn() }));

import { processSreBackgroundAlertTriageJob } from "./background-alert-triage";
import { resolveIncident } from "@/lib/sre/incident-lifecycle";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";

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
  opts: { status?: "sent" | "failed" | "pending"; job?: boolean; provider?: string; dedupKey?: string } = {},
) {
  const [row] = await mockDatabase
    .insert(schema.alertHistory)
    .values({
      message: `${type} message`,
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
