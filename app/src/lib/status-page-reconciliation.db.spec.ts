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
import { reconcileStatusPages } from "./status-page-reconciliation";
import { getPublicComponents } from "@/actions/get-public-components";
import {
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
  const [page] = await mockDatabase
    .insert(schema.statusPages)
    .values({
      organizationId: organization.id,
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
