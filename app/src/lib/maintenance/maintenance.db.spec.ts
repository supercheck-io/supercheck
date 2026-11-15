/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { v7 as uuidv7 } from "uuid";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkMaintenanceWriteRateLimit: jest.fn(async () => ({ allowed: true, remaining: 10 })) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { isIncidentPagingSuppressed, isMonitorInMaintenance } from "./predicate";
import {
  advanceMaintenanceWindows,
  cancelMaintenanceWindow,
  createMaintenanceWindow,
  deleteMaintenanceWindow,
  endMaintenanceWindow,
  extendMaintenanceWindow,
  getMaintenanceWindow,
  listMaintenanceWindows,
  updateMaintenanceWindow,
} from "./windows";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `maintenance_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const org = uuidv7();
const otherOrg = uuidv7();
const project = uuidv7();
const otherProject = uuidv7();
const user = uuidv7();
const [monA, monB, monLate, monOther] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const service = uuidv7();
const actor = { userId: user, organizationId: org, orgPendingDeletion: false, project: { id: project, userRole: "project_editor" } };
const otherActor = { userId: user, organizationId: otherOrg, orgPendingDeletion: false, project: { id: otherProject, userRole: "org_owner" } };

const MIN = 60_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const hm = (d: Date) => d.toISOString().slice(11, 16);
/** A UTC one-off starting `offsetMin` from now. */
const oneOff = (offsetMin: number, duration = 60, extra: Record<string, unknown> = {}) => {
  const start = new Date(Math.ceil((Date.now() + offsetMin * MIN) / MIN) * MIN);
  return { title: "Deploy", scope: "monitors" as const, targets: { monitorIds: [monA] }, recurrence: "once" as const, timezone: "UTC", localStartTime: hm(start), durationMinutes: duration, startsOn: ymd(start), ...extra };
};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  client = postgres(url.toString(), { max: 2, onnotice: () => {} });
  mockDatabase = drizzle(client);
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, 'o', ${org}, now()), (${otherOrg}, 'x', ${otherOrg}, now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project}), (${otherProject}, ${otherOrg}, 'q', ${otherProject})`;
  await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${user}, 'u', 'u@example.com', true, now(), now())`;
  await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target) VALUES
    (${monA}, ${org}, ${project}, 'A', 'http_request', 'https://example.com/a'),
    (${monB}, ${org}, ${project}, 'B', 'http_request', 'https://example.com/b'),
    (${monLate}, ${org}, ${project}, 'Late', 'http_request', 'https://example.com/l'),
    (${monOther}, ${otherOrg}, ${otherProject}, 'Other', 'http_request', 'https://example.com/o')`;
  await client`INSERT INTO sre_services (id, organization_id, project_id, name) VALUES (${service}, ${org}, ${project}, 'Checkout')`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

afterEach(async () => {
  await client`DELETE FROM maintenance_windows`;
});

describe("isMonitorInMaintenance (M5)", () => {
  it("covers only the scoped monitor, only inside the occurrence, never after cancel", async () => {
    const created = await createMaintenanceWindow(actor, oneOff(-5), "api");
    expect(created.ok).toBe(true);
    const now = new Date();
    expect(await isMonitorInMaintenance(monA, now)).toBe(true);
    expect(await isMonitorInMaintenance(monB, now)).toBe(false);
    expect(await isMonitorInMaintenance(monA, new Date(now.getTime() + 2 * 60 * MIN))).toBe(false);
    // A failure that fired before the window opened is not muted, even if handled now.
    expect(await isMonitorInMaintenance(monA, new Date(now.getTime() - 30 * MIN))).toBe(false);
    if (!created.ok) return;
    await client`UPDATE maintenance_windows SET cancelled_at = now() WHERE id = ${created.window.id}`;
    expect(await isMonitorInMaintenance(monA, now)).toBe(false);
  });

  it("project scope covers every monitor in the project and none elsewhere", async () => {
    expect((await createMaintenanceWindow(actor, oneOff(-5, 60, { scope: "project", targets: {} }), "api")).ok).toBe(true);
    expect(await isMonitorInMaintenance(monB, new Date())).toBe(true);
    expect(await isMonitorInMaintenance(monOther, new Date())).toBe(false);
  });

  it("service scope covers a monitor mapped to the service after the window was created (AC13)", async () => {
    expect((await createMaintenanceWindow(actor, oneOff(-5, 60, { scope: "services", targets: { serviceIds: [service] } }), "api")).ok).toBe(true);
    expect(await isMonitorInMaintenance(monLate, new Date())).toBe(false);
    await client`INSERT INTO sre_service_resources (id, service_id, resource_type, resource_id) VALUES (${uuidv7()}, ${service}, 'monitor', ${monLate})`;
    expect(await isMonitorInMaintenance(monLate, new Date())).toBe(true);
    await client`DELETE FROM sre_service_resources WHERE resource_id = ${monLate}`;
  });

  it("keeps the status-page scheduled maintenance rule", async () => {
    const [page] = await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain) VALUES (uuidv7(), ${org}, ${project}, 'S', ${`s${randomUUID().slice(0, 8)}`}) RETURNING id`;
    const [component] = await client`INSERT INTO status_page_components (id, status_page_id, name) VALUES (uuidv7(), ${page!.id}, 'C') RETURNING id`;
    await client`INSERT INTO status_page_component_monitors (component_id, monitor_id) VALUES (${component!.id}, ${monB})`;
    const [incident] = await client`INSERT INTO incidents (id, status_page_id, name, status, impact, scheduled_for, scheduled_until)
      VALUES (uuidv7(), ${page!.id}, 'm', 'scheduled', 'minor', now() - interval '5 minutes', now() + interval '1 hour') RETURNING id`;
    await client`INSERT INTO incident_components (id, incident_id, component_id, old_status, new_status) VALUES (uuidv7(), ${incident!.id}, ${component!.id}, 'operational', 'under_maintenance')`;
    expect(await isMonitorInMaintenance(monB, new Date())).toBe(true);
    await client`DELETE FROM incidents WHERE id = ${incident!.id}`;
  });
});

describe("isIncidentPagingSuppressed (M8, AC14)", () => {
  it("holds an automatic incident whose monitor is in maintenance, never a declared one", async () => {
    await createMaintenanceWindow(actor, oneOff(-5), "api");
    const [auto] = await client`INSERT INTO sre_incidents (id, organization_id, project_id, incident_number, title, severity, status) VALUES (uuidv7(), ${org}, ${project}, 1, 'auto', 'sev2', 'triggered') RETURNING id`;
    const [alert] = await client`INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, source_type, source_id, title, fired_at, status)
      VALUES (uuidv7(), ${org}, ${project}, ${randomUUID().replaceAll("-", "")}, 'monitor', ${monA}, 'Failure', now(), 'firing') RETURNING id`;
    await client`INSERT INTO sre_incident_alerts (id, incident_id, alert_event_id, role) VALUES (uuidv7(), ${auto!.id}, ${alert!.id}, 'trigger')`;
    const [declared] = await client`INSERT INTO sre_incidents (id, organization_id, project_id, incident_number, title, severity, status) VALUES (uuidv7(), ${org}, ${project}, 2, 'declared', 'sev2', 'triggered') RETURNING id`;
    await client`INSERT INTO sre_incident_resources (id, incident_id, resource_type, resource_id) VALUES (uuidv7(), ${declared!.id}, 'monitor', ${monA})`;
    expect(await isIncidentPagingSuppressed(auto!.id, new Date())).toBe(true);
    expect(await isIncidentPagingSuppressed(declared!.id, new Date())).toBe(false);
    expect(await isIncidentPagingSuppressed(auto!.id, new Date(Date.now() + 3 * 60 * MIN))).toBe(false);
  });
});

describe("window lifecycle (M10, AC12)", () => {
  it("ends an active one-off at once and completes it", async () => {
    const created = await createMaintenanceWindow(actor, oneOff(-5), "api");
    if (!created.ok) throw new Error(created.error);
    expect(created.window.state).toBe("active");
    const ended = await endMaintenanceWindow(actor, created.window.id);
    expect(ended).toMatchObject({ ok: true, window: { state: "completed" } });
    expect(await isMonitorInMaintenance(monA, new Date())).toBe(false);
  });

  it("extends only an active window and never past 7 days", async () => {
    const created = await createMaintenanceWindow(actor, oneOff(-5), "api");
    if (!created.ok) throw new Error(created.error);
    const extended = await extendMaintenanceWindow(actor, created.window.id, { byMinutes: 30 });
    expect(extended.ok && extended.window.occurrenceEndsAt!.getTime() - created.window.occurrenceEndsAt!.getTime()).toBe(30 * MIN);
    expect(await extendMaintenanceWindow(actor, created.window.id, { byMinutes: 7 * 24 * 60 })).toMatchObject({ ok: false, code: "invalid" });
    const later = await createMaintenanceWindow(actor, oneOff(120), "api");
    if (!later.ok) throw new Error(later.error);
    expect(await extendMaintenanceWindow(actor, later.window.id, { byMinutes: 30 })).toMatchObject({ ok: false, code: "conflict" });
  });

  it("cancels a scheduled one-off and resolves its linked status-page maintenance", async () => {
    const created = await createMaintenanceWindow(actor, oneOff(120), "api");
    if (!created.ok) throw new Error(created.error);
    const [page] = await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain) VALUES (uuidv7(), ${org}, ${project}, 'S2', ${`s${randomUUID().slice(0, 8)}`}) RETURNING id`;
    const [linked] = await client`INSERT INTO incidents (id, status_page_id, name, status, impact, scheduled_for, scheduled_until, maintenance_window_id, deliver_notifications)
      VALUES (uuidv7(), ${page!.id}, 'm', 'scheduled', 'minor', now() + interval '2 hours', now() + interval '3 hours', ${created.window.id}, false) RETURNING id`;
    // While it is on a status page: no delete, no MCP change, and a role without status_page:update is refused.
    expect(await deleteMaintenanceWindow(actor, created.window.id)).toMatchObject({ ok: false, code: "conflict" });
    expect(await cancelMaintenanceWindow(actor, created.window.id, "mcp")).toMatchObject({ ok: false, code: "conflict" });
    expect(await cancelMaintenanceWindow(actor, created.window.id)).toMatchObject({ ok: true, window: { state: "cancelled" } });
    expect(await deleteMaintenanceWindow(actor, created.window.id)).toMatchObject({ ok: true });
    const [row] = await client`SELECT status FROM incidents WHERE id = ${linked!.id}`;
    expect(row!.status).toBe("resolved");
    const updates = await client`SELECT body, deliver_notifications FROM incident_updates WHERE incident_id = ${linked!.id}`;
    expect(updates).toEqual([expect.objectContaining({ body: "This maintenance was cancelled.", deliver_notifications: false })]);
    const events = await client`SELECT 1 FROM status_page_notification_events WHERE incident_id = ${linked!.id}`;
    expect(events).toHaveLength(0);
  });

  it("advances a finished occurrence of a series to the next one and completes a finished one-off", async () => {
    const series = await createMaintenanceWindow(actor, { ...oneOff(-5), recurrence: "daily" }, "api");
    const once = await createMaintenanceWindow(actor, oneOff(-5), "api");
    if (!series.ok || !once.ok) throw new Error("create failed");
    await client`UPDATE maintenance_windows SET occurrence_starts_at = now() - interval '2 hours', occurrence_ends_at = now() - interval '1 hour'`;
    expect(await advanceMaintenanceWindows()).toBe(2);
    const seriesNow = await getMaintenanceWindow(actor, series.window.id);
    const onceNow = await getMaintenanceWindow(actor, once.window.id);
    expect(seriesNow.ok && seriesNow.window.occurrenceStartsAt!.getTime()).toBeGreaterThan(Date.now());
    expect(onceNow).toMatchObject({ ok: true, window: { state: "completed" } });
  });
});

describe("updates", () => {
  it("refuses schedule edits on an active one-off and keeps a status-page window one-off", async () => {
    const active = await createMaintenanceWindow(actor, oneOff(-5), "api");
    if (!active.ok) throw new Error(active.error);
    expect(await updateMaintenanceWindow(actor, active.window.id, { durationMinutes: 120 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await updateMaintenanceWindow(actor, active.window.id, { title: "Renamed" })).toMatchObject({ ok: true, window: { title: "Renamed" } });

    const later = await createMaintenanceWindow(actor, oneOff(120), "api");
    if (!later.ok) throw new Error(later.error);
    const [page] = await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain) VALUES (uuidv7(), ${org}, ${project}, 'S3', ${`s${randomUUID().slice(0, 8)}`}) RETURNING id`;
    await client`INSERT INTO incidents (id, status_page_id, name, status, impact, scheduled_for, scheduled_until, maintenance_window_id)
      VALUES (uuidv7(), ${page!.id}, 'm', 'scheduled', 'minor', now() + interval '2 hours', now() + interval '3 hours', ${later.window.id})`;
    expect(await updateMaintenanceWindow(actor, later.window.id, { recurrence: "daily" })).toMatchObject({ ok: false, code: "invalid" });
    const moved = await updateMaintenanceWindow(actor, later.window.id, { durationMinutes: 90 });
    expect(moved.ok && moved.window.occurrenceEndsAt!.getTime() - moved.window.occurrenceStartsAt!.getTime()).toBe(90 * MIN);
    const [linked] = await client`SELECT scheduled_until FROM incidents WHERE maintenance_window_id = ${later.window.id}`;
    expect(new Date(linked!.scheduled_until).getTime()).toBe(moved.ok && moved.window.occurrenceEndsAt!.getTime());
  });

  it("ends a series' active occurrence by moving to the next one, and lists live windows before history", async () => {
    const series = await createMaintenanceWindow(actor, { ...oneOff(-5), recurrence: "daily" }, "api");
    if (!series.ok) throw new Error(series.error);
    const ended = await endMaintenanceWindow(actor, series.window.id);
    expect(ended).toMatchObject({ ok: true, window: { state: "scheduled" } });
    expect(ended.ok && ended.window.occurrenceStartsAt!.getTime()).toBeGreaterThan(Date.now());
    // The ended occurrence is over, so it can no longer be extended.
    expect(await extendMaintenanceWindow(actor, series.window.id, { byMinutes: 30 })).toMatchObject({ ok: false, code: "conflict" });
    await client`INSERT INTO maintenance_windows (id, organization_id, project_id, title, scope, recurrence, timezone, local_start_time, duration_minutes, starts_on, occurrence_starts_at, occurrence_ends_at, completed_at)
      SELECT uuidv7(), ${org}, ${project}, 'old', 'project', 'once', 'UTC', '01:00', 60, '2026-01-01', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', now() FROM generate_series(1, 205)`;
    const listed = await listMaintenanceWindows(actor);
    expect(listed.ok && listed.windows[0]!.id).toBe(series.window.id);
  });
});

describe("validation, caps and tenant isolation (AC7)", () => {
  it("rejects targets in another project and a viewer", async () => {
    expect(await createMaintenanceWindow(actor, oneOff(60, 60, { targets: { monitorIds: [monOther] } }), "api")).toMatchObject({ ok: false, code: "not_found" });
    expect(await createMaintenanceWindow({ ...actor, project: { id: project, userRole: "project_viewer" } }, oneOff(60), "api")).toMatchObject({ ok: false, code: "forbidden" });
    expect(await createMaintenanceWindow({ ...actor, orgPendingDeletion: true }, oneOff(60), "api")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("never reads or writes another org's window", async () => {
    const created = await createMaintenanceWindow(actor, oneOff(60), "api");
    if (!created.ok) throw new Error(created.error);
    expect(await getMaintenanceWindow(otherActor, created.window.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await cancelMaintenanceWindow(otherActor, created.window.id)).toMatchObject({ ok: false, code: "not_found" });
    const listed = await listMaintenanceWindows(otherActor);
    expect(listed.ok && listed.windows).toEqual([]);
  });

  it("lists by state and by covered monitor", async () => {
    await createMaintenanceWindow(actor, oneOff(-5), "api");
    await createMaintenanceWindow(actor, oneOff(120, 60, { targets: { monitorIds: [monB] } }), "api");
    const active = await listMaintenanceWindows(actor, { state: "active" });
    const forB = await listMaintenanceWindows(actor, { monitorId: monB });
    expect(active.ok && active.windows.map((w) => w.state)).toEqual(["active"]);
    expect(forB.ok && forB.windows).toHaveLength(1);
  });
});
