/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { checkSubscriberLimit } from "@/lib/middleware/plan-enforcement";
import { sendWebhookVerificationChallenge } from "@/lib/webhook-delivery.service";
import { sendWebhookChallenge } from "./incident-notifications/webhook-verification";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("./incident-notifications/send-incident-notifications", () => ({
  sendIncidentNotifications: jest.fn(async () => ({ success: true })),
}));
jest.mock("./incident-notifications/send-webhook-notifications", () => ({
  sendWebhookNotifications: jest.fn(async () => ({ success: true })),
}));
jest.mock("./incident-notifications/send-slack-notifications", () => ({
  sendSlackNotifications: jest.fn(async () => ({ success: true })),
}));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({
  requirePermissions: jest.fn(async () => undefined),
}));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkSubscriberLimit: jest.fn() }));
jest.mock("@/lib/webhook-delivery.service", () => ({ sendWebhookVerificationChallenge: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { reconcileStatusPages } from "./status-page-reconciliation";
import { updateIncidentStatus } from "@/actions/update-incident-status";
import { requireProjectContext } from "@/lib/project-context";
import { getPublicComponents } from "@/actions/get-public-components";
import { checkUptimePercentage } from "@/lib/status-page-uptime";
import { monitorAggregationService } from "@/lib/monitor-aggregation-service";
import {
  deleteExpiredDeliveries,
  enqueuePendingDeliveries,
  processDelivery,
} from "./incident-notifications/delivery-worker";
import type { Queue } from "bullmq";

const execFileAsync = promisify(execFile);
const name = `status_pages_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let pageId: string;
let componentId: string;
let monitorId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await execFileAsync(
    process.execPath,
    [path.join(appRoot, "scripts/db-migrate.js")],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        SELF_HOSTED: "true",
        NODE_ENV: "test",
      },
      timeout: 90000,
    },
  );
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
  await client`TRUNCATE status_pages, monitors, organization CASCADE`;
  const [organization] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Test", createdAt: new Date() })
    .returning();
  const [project] = await mockDatabase
    .insert(schema.projects)
    .values({ organizationId: organization.id, name: "Project" })
    .returning();
  const [testUser] = await mockDatabase
    .insert(schema.user)
    .values({ name: "Test User", email: `${randomUUID()}@example.com` })
    .returning();
  jest.mocked(requireProjectContext).mockResolvedValue({
    userId: testUser.id,
    organizationId: organization.id,
    project: { id: project.id, name: "Project" },
  } as never);
  const [page] = await mockDatabase
    .insert(schema.statusPages)
    .values({
      organizationId: organization.id,
      projectId: project.id,
      name: "Status",
      subdomain: randomUUID().replaceAll("-", ""),
      status: "published",
    })
    .returning();
  pageId = page.id;
  const [monitor] = await mockDatabase
    .insert(schema.monitors)
    .values({
      organizationId: organization.id,
      name: "API",
      type: "http_request",
      target: "https://example.com",
      status: "up",
    })
    .returning();
  monitorId = monitor.id;
  const [component] = await mockDatabase
    .insert(schema.statusPageComponents)
    .values({ statusPageId: pageId, name: "API" })
    .returning();
  componentId = component.id;
  await mockDatabase
    .insert(schema.statusPageComponentMonitors)
    .values({ componentId, monitorId });
});

it("drives component health automatically and creates public incidents only when enabled", async () => {
  await mockDatabase
    .update(schema.monitors)
    .set({ status: "down", lastCheckAt: new Date() })
    .where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  expect(
    (await mockDatabase.query.statusPageComponents.findFirst())?.status,
  ).toBe("major_outage");
  expect(await mockDatabase.query.incidents.findMany()).toHaveLength(0);
  await mockDatabase
    .update(schema.statusPageComponents)
    .set({ autoCreateIncidents: true, updatedAt: new Date() })
    .where(eq(schema.statusPageComponents.id, componentId));
  await Promise.all([reconcileStatusPages(), reconcileStatusPages()]);
  expect(await mockDatabase.query.incidents.findMany()).toHaveLength(1);
  expect(
    await mockDatabase.query.statusPageNotificationEvents.findMany(),
  ).toHaveLength(1);
  await mockDatabase
    .update(schema.monitors)
    .set({ status: "up", lastCheckAt: new Date() })
    .where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  expect((await mockDatabase.query.incidents.findFirst())?.status).toBe(
    "resolved",
  );
  expect(
    (await mockDatabase.query.statusPageComponents.findFirst())?.status,
  ).toBe("operational");
});

it("does not publish an outage for an unrun pending monitor", async () => {
  await mockDatabase.update(schema.monitors).set({ status: "pending" }).where(eq(schema.monitors.id, monitorId));
  await mockDatabase.update(schema.statusPageComponents).set({ autoCreateIncidents: true, updatedAt: new Date() }).where(eq(schema.statusPageComponents.id, componentId));
  await reconcileStatusPages();
  expect(await mockDatabase.query.incidents.findMany()).toHaveLength(0);
});

it("keeps the worst active manual incident status", async () => {
  for (const status of ["degraded_performance", "major_outage"] as const) {
    const [incident] = await mockDatabase.insert(schema.incidents).values({ statusPageId: pageId, name: status }).returning();
    await mockDatabase.insert(schema.incidentComponents).values({ incidentId: incident.id, componentId, newStatus: status });
  }
  await reconcileStatusPages();
  expect((await mockDatabase.query.statusPageComponents.findFirst())?.status).toBe("major_outage");
});

it("uses failed checks for uptime even with no incident", async () => {
  await mockDatabase
    .insert(schema.monitorResults)
    .values({
      monitorId,
      checkedAt: new Date(),
      location: "local",
      status: "down",
      isUp: false,
    });
  const result = await getPublicComponents(pageId);
  expect(result.success).toBe(true);
  expect(result.components[0].dailyMetrics).toEqual([
    expect.objectContaining({ totalChecks: 1, successfulChecks: 0 }),
  ]);
});

it("uses historical location rows when a single-location monitor has no combined row", async () => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - 1);
  await mockDatabase.insert(schema.monitorAggregates).values({
    monitorId,
    periodType: "daily",
    periodStart: day,
    location: "local",
    totalChecks: 10,
    successfulChecks: 9,
    failedChecks: 1,
    uptimePercentage: "90.00",
  });

  const result = await getPublicComponents(pageId);
  expect(result.success).toBe(true);
  expect(result.components[0].dailyMetrics).toEqual([
    { date: day.toISOString().slice(0, 10), totalChecks: 10, successfulChecks: 9 },
  ]);
  expect(checkUptimePercentage(result.components[0].dailyMetrics)).toBe(90);

  await mockDatabase.insert(schema.monitorAggregates).values({
    monitorId,
    periodType: "daily",
    periodStart: day,
    location: null,
    totalChecks: 10,
    successfulChecks: 9,
    failedChecks: 1,
    uptimePercentage: "90.00",
  });
  const combined = await getPublicComponents(pageId);
  expect(combined.components[0].dailyMetrics).toEqual(result.components[0].dailyMetrics);
});

it("writes a combined daily aggregate for a single-location monitor", async () => {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - 1);
  await mockDatabase.insert(schema.monitorResults).values([
    { monitorId, checkedAt: new Date(day.getTime() + 60_000), location: "local", status: "up", isUp: true },
    { monitorId, checkedAt: new Date(day.getTime() + 120_000), location: "local", status: "down", isUp: false },
  ]);

  const aggregation = await monitorAggregationService.runDailyAggregation();
  expect(aggregation.success).toBe(true);
  expect(aggregation.errors).toEqual([]);
  const rows = await mockDatabase.select().from(schema.monitorAggregates).where(and(
    eq(schema.monitorAggregates.monitorId, monitorId),
    eq(schema.monitorAggregates.periodType, "daily"),
    eq(schema.monitorAggregates.periodStart, day),
  ));
  expect(rows).toHaveLength(2);
  const location = rows.find((row) => row.location === "local");
  const combined = rows.find((row) => row.location === null);
  expect(location).toBeDefined();
  expect(combined).toMatchObject({
    totalChecks: location?.totalChecks,
    successfulChecks: location?.successfulChecks,
    failedChecks: location?.failedChecks,
  });
  expect(combined?.totalChecks).toBe(2);
  expect(combined?.successfulChecks).toBe(1);
  expect(combined?.location).toBeNull();

  const rerun = await monitorAggregationService.runDailyAggregation();
  expect(rerun.success).toBe(true);
  expect(await mockDatabase.select().from(schema.monitorAggregates).where(and(
    eq(schema.monitorAggregates.monitorId, monitorId),
    eq(schema.monitorAggregates.periodType, "daily"),
    eq(schema.monitorAggregates.periodStart, day),
  ))).toHaveLength(2);
});

it("starts and completes maintenance, and catches up an expired window without a false start", async () => {
  const [incident] = await mockDatabase
    .insert(schema.incidents)
    .values({
      statusPageId: pageId,
      name: "Maintenance",
      status: "scheduled",
      scheduledFor: new Date(Date.now() - 10000),
      scheduledUntil: new Date(Date.now() + 60000),
    })
    .returning();
  await mockDatabase
    .insert(schema.incidentComponents)
    .values({
      incidentId: incident.id,
      componentId,
      oldStatus: "operational",
      newStatus: "under_maintenance",
    });
  await reconcileStatusPages();
  expect((await mockDatabase.query.incidents.findFirst())?.status).toBe(
    "monitoring",
  );
  expect(
    (await mockDatabase.query.statusPageComponents.findFirst())?.status,
  ).toBe("under_maintenance");
  await mockDatabase
    .update(schema.incidents)
    .set({ scheduledUntil: new Date(Date.now() - 1000) })
    .where(eq(schema.incidents.id, incident.id));
  await reconcileStatusPages();
  expect(
    (await mockDatabase.query.statusPageComponents.findFirst())?.status,
  ).toBe("operational");
  await mockDatabase
    .update(schema.incidents)
    .set({ status: "scheduled" })
    .where(eq(schema.incidents.id, incident.id));
  await reconcileStatusPages();
  expect((await mockDatabase.query.incidents.findFirst())?.status).toBe(
    "resolved",
  );
});

it("persists delivery history and never queues a resolution ahead of an earlier pending update", async () => {
  const [subscriber] = await mockDatabase
    .insert(schema.statusPageSubscribers)
    .values({
      statusPageId: pageId,
      mode: "email",
      email: "test@example.com",
      verifiedAt: new Date(),
    })
    .returning();
  const [incident] = await mockDatabase
    .insert(schema.incidents)
    .values({ statusPageId: pageId, name: "Outage" })
    .returning();
  for (const status of ["investigating", "resolved"] as const) {
    const [update] = await mockDatabase
      .insert(schema.incidentUpdates)
      .values({
        incidentId: incident.id,
        body: status,
        status,
        deliverNotifications: true,
      })
      .returning();
    await mockDatabase
      .insert(schema.statusPageNotificationEvents)
      .values({
        incidentId: incident.id,
        updateId: update.id,
        isCreation: status === "investigating",
      });
  }
  const queue = { add: jest.fn(), getJob: jest.fn(async () => null) };
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(queue.add).toHaveBeenCalledTimes(1);
  const firstId = queue.add.mock.calls[0][1].deliveryId;
  const read = jest.spyOn(mockDatabase.query.statusPageNotificationEvents, "findFirst");
  read.mockRejectedValueOnce(new Error("Transient DB read"));
  await expect(processDelivery(firstId)).rejects.toThrow("Transient DB read");
  expect((await mockDatabase.query.statusPageNotificationDeliveries.findFirst({ where: eq(schema.statusPageNotificationDeliveries.id, firstId) }))?.leasedUntil).toBeNull();
  read.mockRestore();
  await processDelivery(firstId);
  expect(
    (
      await mockDatabase.query.statusPageNotificationDeliveries.findFirst({
        where: eq(schema.statusPageNotificationDeliveries.id, firstId),
      })
    )?.status,
  ).toBe("delivered");
  queue.add.mockClear();
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(queue.add).toHaveBeenCalledTimes(1);
  expect(queue.add.mock.calls[0][1].deliveryId).not.toBe(firstId);
  expect(
    (
      await mockDatabase.query.statusPageNotificationDeliveries.findMany()
    ).every((delivery) => delivery.subscriberId === subscriber.id),
  ).toBe(true);
});

it("queues every pending delivery in one tick instead of stopping at 100", async () => {
  const [incident] = await mockDatabase
    .insert(schema.incidents)
    .values({ statusPageId: pageId, name: "Fanout" })
    .returning();
  const [update] = await mockDatabase
    .insert(schema.incidentUpdates)
    .values({ incidentId: incident.id, body: "Fanout", status: "investigating", deliverNotifications: true })
    .returning();
  await mockDatabase.insert(schema.statusPageNotificationEvents).values({ incidentId: incident.id, updateId: update.id, isCreation: true });
  await mockDatabase.insert(schema.statusPageSubscribers).values(
    Array.from({ length: 120 }, (_, index) => ({
      statusPageId: pageId,
      mode: "email" as const,
      email: `subscriber-${index}@example.com`,
      verifiedAt: new Date(),
    })),
  );
  const queue = { add: jest.fn(), getJob: jest.fn(async () => null) };
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(await mockDatabase.query.statusPageNotificationDeliveries.findMany()).toHaveLength(120);
  expect(queue.add).toHaveBeenCalledTimes(120);
});

it("does not re-queue rows that a worker already holds, so later backlog rows advance", async () => {
  const [incident] = await mockDatabase
    .insert(schema.incidents)
    .values({ statusPageId: pageId, name: "Backlog" })
    .returning();
  const [update] = await mockDatabase
    .insert(schema.incidentUpdates)
    .values({ incidentId: incident.id, body: "Backlog", status: "investigating", deliverNotifications: true })
    .returning();
  await mockDatabase
    .insert(schema.statusPageNotificationEvents)
    .values({ incidentId: incident.id, updateId: update.id, isCreation: true });
  const subscribers = await mockDatabase
    .insert(schema.statusPageSubscribers)
    .values(
      Array.from({ length: 2 }, (_, index) => ({
        statusPageId: pageId,
        mode: "email" as const,
        email: `backlog-${index}@example.com`,
        verifiedAt: new Date(),
      })),
    )
    .returning();

  const queue = { add: jest.fn(), getJob: jest.fn(async () => null) };
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(queue.add).toHaveBeenCalledTimes(2);

  // Immediately after enqueueing, both rows are leased to their BullMQ jobs.
  queue.add.mockClear();
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(queue.add).not.toHaveBeenCalled();

  // Once a lease lapses (lost worker), that row is eligible again; the other
  // row stays held so the backlog cannot pin the same first rows forever.
  const queued = await mockDatabase.query.statusPageNotificationDeliveries.findMany();
  const lapsed = queued.find(
    (delivery) => delivery.subscriberId === subscribers[0].id,
  );
  if (!lapsed) throw new Error("delivery for the first subscriber missing");
  await mockDatabase
    .update(schema.statusPageNotificationDeliveries)
    .set({ enqueuedAt: new Date(Date.now() - 10 * 60 * 1000) })
    .where(eq(schema.statusPageNotificationDeliveries.id, lapsed.id));
  queue.add.mockClear();
  await enqueuePendingDeliveries(queue as unknown as Queue);
  expect(queue.add).toHaveBeenCalledTimes(1);
});

it("deletes only terminal deliveries older than the retention window", async () => {
  const [incident] = await mockDatabase.insert(schema.incidents).values({ statusPageId: pageId, name: "Retention" }).returning();
  const [update] = await mockDatabase.insert(schema.incidentUpdates).values({ incidentId: incident.id, body: "Retention", status: "investigating" }).returning();
  const [event] = await mockDatabase.insert(schema.statusPageNotificationEvents).values({ incidentId: incident.id, updateId: update.id }).returning();
  const [oldSubscriber, recentSubscriber] = await mockDatabase
    .insert(schema.statusPageSubscribers)
    .values([
      { statusPageId: pageId, mode: "email", email: "old@example.com", verifiedAt: new Date() },
      { statusPageId: pageId, mode: "email", email: "recent@example.com", verifiedAt: new Date() },
    ])
    .returning();
  await mockDatabase.insert(schema.statusPageNotificationDeliveries).values([
    { eventId: event.id, subscriberId: oldSubscriber.id, mode: "email", status: "delivered", updatedAt: new Date(Date.now() - 31 * 86400000) },
    { eventId: event.id, subscriberId: recentSubscriber.id, mode: "email", status: "delivered", updatedAt: new Date(Date.now() - 29 * 86400000) },
  ]);
  await deleteExpiredDeliveries(30);
  const remaining = await mockDatabase.query.statusPageNotificationDeliveries.findMany();
  expect(remaining).toHaveLength(1);
  expect(remaining[0].subscriberId).toBe(recentSubscriber.id);
});

it("does not recreate a manually resolved automatic incident until the component recovers", async () => {
  await mockDatabase.update(schema.statusPageComponents).set({ autoCreateIncidents: true, updatedAt: new Date() }).where(eq(schema.statusPageComponents.id, componentId));
  await mockDatabase.update(schema.monitors).set({ status: "down", lastCheckAt: new Date() }).where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  const [automatic] = await mockDatabase.query.incidents.findMany();
  expect(automatic.status).toBe("investigating");

  // Manual resolve sets the suppression flag (covered by the action test below).
  await mockDatabase.update(schema.incidents).set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(schema.incidents.id, automatic.id));
  await mockDatabase.update(schema.statusPageComponents).set({ autoIncidentSuppressed: true, updatedAt: new Date() }).where(eq(schema.statusPageComponents.id, componentId));

  await reconcileStatusPages();
  expect(await mockDatabase.query.incidents.findMany()).toHaveLength(1);

  await mockDatabase.update(schema.monitors).set({ status: "up", lastCheckAt: new Date() }).where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  expect((await mockDatabase.query.statusPageComponents.findFirst())?.autoIncidentSuppressed).toBe(false);

  await mockDatabase.update(schema.monitors).set({ status: "down", lastCheckAt: new Date() }).where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  expect(await mockDatabase.query.incidents.findMany()).toHaveLength(2);
});

it("writes automatic incident text in the configured page language", async () => {
  await mockDatabase.update(schema.statusPages).set({ language: "es" }).where(eq(schema.statusPages.id, pageId));
  await mockDatabase.update(schema.statusPageComponents).set({ autoCreateIncidents: true, updatedAt: new Date() }).where(eq(schema.statusPageComponents.id, componentId));
  await mockDatabase.update(schema.monitors).set({ status: "down", lastCheckAt: new Date() }).where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();

  const incident = await mockDatabase.query.incidents.findFirst();
  const update = await mockDatabase.query.incidentUpdates.findFirst();
  expect(incident?.name).toBe("API está experimentando una interrupción");
  expect(update?.body).toBe("La monitorización detectó un problema de disponibilidad.");
});

it("sets suppression when an automatic incident is resolved manually", async () => {
  await mockDatabase.update(schema.statusPageComponents).set({ autoCreateIncidents: true, updatedAt: new Date() }).where(eq(schema.statusPageComponents.id, componentId));
  await mockDatabase.update(schema.monitors).set({ status: "down", lastCheckAt: new Date() }).where(eq(schema.monitors.id, monitorId));
  await reconcileStatusPages();
  const automatic = await mockDatabase.query.incidents.findFirst();

  const result = await updateIncidentStatus({
    incidentId: automatic!.id,
    statusPageId: pageId,
    status: "resolved",
    body: "Resolved manually while the monitor is still down.",
    deliverNotifications: true,
    restoreComponentStatus: false,
  });

  expect(result.success).toBe(true);
  expect((await mockDatabase.query.statusPageComponents.findFirst())?.autoIncidentSuppressed).toBe(true);
});

async function pendingWebhook() {
  const [row] = await mockDatabase.insert(schema.statusPageSubscribers).values({
    statusPageId: pageId, mode: "webhook", endpoint: `https://${randomUUID()}.example.com/hook`,
  }).returning();
  return { subscriberId: row.id, statusPageId: pageId, endpoint: row.endpoint! };
}

it("serializes concurrent webhook activations against the verified subscriber limit", async () => {
  jest.mocked(checkSubscriberLimit).mockImplementation(async (_org, count) => ({ allowed: count < 1, limit: 1, error: count >= 1 ? "Subscriber limit reached" : undefined }) as never);
  jest.mocked(sendWebhookVerificationChallenge).mockResolvedValue({ success: true });
  const pending = await Promise.all([pendingWebhook(), pendingWebhook()]);
  const results = await Promise.all(pending.map(sendWebhookChallenge));
  expect(results.filter((result) => result.verified)).toHaveLength(1);
  const rows = await mockDatabase.query.statusPageSubscribers.findMany();
  expect(rows.filter((row) => row.verifiedAt)).toHaveLength(1);
});

it("rejects an older ownership response after a newer challenge has replaced it", async () => {
  jest.mocked(checkSubscriberLimit).mockResolvedValue({ allowed: true } as never);
  const pending = await pendingWebhook();
  let finishOld!: (result: { success: boolean }) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  jest.mocked(sendWebhookVerificationChallenge)
    .mockImplementationOnce(() => { started(); return new Promise((resolve) => { finishOld = resolve; }); })
    .mockResolvedValueOnce({ success: false, error: "No echo" });
  const older = sendWebhookChallenge(pending);
  await ready;
  await expect(sendWebhookChallenge(pending)).resolves.toMatchObject({ verified: false });
  finishOld({ success: true });
  await expect(older).resolves.toMatchObject({ verified: false });
  expect((await mockDatabase.query.statusPageSubscribers.findFirst())?.verifiedAt).toBeNull();
});

it("does not reactivate a subscriber removed while endpoint verification was pending", async () => {
  jest.mocked(checkSubscriberLimit).mockResolvedValue({ allowed: true } as never);
  const pending = await pendingWebhook();
  jest.mocked(sendWebhookVerificationChallenge).mockImplementationOnce(async () => {
    await mockDatabase.update(schema.statusPageSubscribers).set({ purgeAt: new Date() }).where(eq(schema.statusPageSubscribers.id, pending.subscriberId));
    return { success: true };
  });
  await expect(sendWebhookChallenge(pending)).resolves.toMatchObject({ verified: false });
  expect((await mockDatabase.query.statusPageSubscribers.findFirst())?.verifiedAt).toBeNull();
});

it("locks the automatic component before its incident to avoid deadlocking reconciliation", async () => {
  const [incident] = await mockDatabase.insert(schema.incidents).values({ statusPageId: pageId, sourceComponentId: componentId, name: "Automatic outage", status: "investigating" }).returning();
  let action!: ReturnType<typeof updateIncidentStatus>;
  await client.begin(async (reconciler) => {
    await reconciler`SELECT id FROM status_page_components WHERE id = ${componentId} FOR UPDATE`;
    action = updateIncidentStatus({ incidentId: incident.id, statusPageId: pageId, status: "resolved", body: "Resolved manually", deliverNotifications: false, restoreComponentStatus: false });
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await client`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%update "status_page_components"%'`;
      if (rows.length) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await reconciler`SET LOCAL lock_timeout = '500ms'`;
    // Reconciliation can still lock the incident while the action waits for
    // its component. The old incident-first order timed out here.
    await reconciler`SELECT id FROM incidents WHERE id = ${incident.id} FOR UPDATE`;
  });
  await expect(action).resolves.toMatchObject({ success: true });
});
