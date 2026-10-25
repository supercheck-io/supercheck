/** @jest-environment node */
// Real-PostgreSQL proof that 2026-10 (snake_case) webhook payloads, passed through
// normalizePolarPayload exactly as src/utils/auth.ts does, drive the real handlers.
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
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));
import {
  handleSubscriptionActive,
  handleSubscriptionCanceled,
  handleSubscriptionRevoked,
  handleSubscriptionPastDue,
  handleSubscriptionUncanceled,
  handleSubscriptionUpdated,
  handleOrderPaid,
  handleOrderCreated,
  handleCustomerCreated,
  handleCustomerStateChanged,
  handleCustomerDeleted,
  cleanupExpiredWebhooks,
  handleSubscriptionCreated,
} from "./polar-webhooks";
import { normalizePolarPayload } from "./polar-payload";
import { reconcilePolarSubscription } from "@/lib/services/subscription-reconciliation";
import { getBillingReconciliationStatus } from "@/lib/billing/reconciliation-status";

const name = `polar_wh_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;
let otherOrgId: string;
const SUB = "sub_1";
const CUS = "cus_1";

type Handler = (payload: never) => Promise<unknown>;
function deliver(
  handler: Handler,
  type: string,
  data: Record<string, unknown>,
  at: string,
) {
  // JSON round trip mirrors the provider body the plugin parses after verifying the signature.
  const body = JSON.parse(JSON.stringify({ type, timestamp: at, data }));
  return handler(normalizePolarPayload(body) as never);
}
function subscription(over: Record<string, unknown> = {}) {
  return {
    id: SUB,
    status: "active",
    customer_id: CUS,
    product_id: "prod_pro",
    product: { id: "prod_pro" },
    current_period_start: "2026-10-01T00:00:00Z",
    current_period_end: "2026-11-01T00:00:00Z",
    cancel_at_period_end: false,
    ended_at: null,
    metadata: { referenceId: orgId },
    customer: { id: CUS, external_id: `organization:${orgId}`, metadata: {} },
    ...over,
  };
}
const org = async (id = orgId) =>
  (
    await mockDatabase
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, id))
  )[0];

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL required for disposable database");
  process.env.POLAR_PLUS_PRODUCT_ID = "prod_plus";
  process.env.POLAR_PRO_PRODUCT_ID = "prod_pro";
  maintenance = postgres(process.env.TEST_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(
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
  await client`TRUNCATE organization, "user" CASCADE`;
  await client`TRUNCATE webhook_idempotency`;
  const [a] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Team", createdAt: new Date(), polarCustomerId: CUS })
    .returning();
  const [b] = await mockDatabase
    .insert(schema.organization)
    .values({
      name: "Other",
      createdAt: new Date(),
      polarCustomerId: "cus_other",
    })
    .returning();
  orgId = a.id;
  otherOrgId = b.id;
});

describe("2026-10 webhook payloads through the real handlers", () => {
  it.each([false, true])("reconciles an authoritative snapshot without overwriting a concurrent webhook (changed=%s)", async (changed) => {
    await deliver(handleSubscriptionActive, "subscription.active", subscription(), "2026-10-01T00:00:01Z");
    await mockDatabase.update(schema.organization).set({ playwrightMinutesUsed: 11 }).where(eq(schema.organization.id, orgId));
    const savedFetch = global.fetch;
    const savedEnv = { SELF_HOSTED: process.env.SELF_HOSTED, POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET };
    process.env.SELF_HOSTED = "false";
    process.env.POLAR_ACCESS_TOKEN = "test";
    process.env.POLAR_WEBHOOK_SECRET = "test";
    let injectConflict = changed;
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith("/state")) return new Response(JSON.stringify({ id: CUS, active_subscriptions: [] }));
      if (injectConflict) {
        injectConflict = false;
        await mockDatabase.update(schema.organization).set({ polarWebhookEventKey: "concurrent-new-event" }).where(eq(schema.organization.id, orgId));
      }
      return new Response(JSON.stringify({ ...subscription(), status: "unpaid", created_at: "2026-10-01T00:00:00Z", modified_at: "2026-10-25T00:00:00Z" }));
    });
    try {
      if (changed) await expect(handleCustomerStateChanged({ type: "customer.state_changed", data: { id: CUS } })).rejects.toThrow("retry");
      else expect(await reconcilePolarSubscription(orgId)).toBe(true);
      expect((await org()).subscriptionStatus).toBe(changed ? "active" : "none");
      expect(Number((await org()).playwrightMinutesUsed)).toBe(11);
      if (changed) {
        await handleCustomerStateChanged({ type: "customer.state_changed", data: { id: CUS } });
        expect((await org()).subscriptionStatus).toBe("none");
        expect(Number((await org()).playwrightMinutesUsed)).toBe(11);
      }
    } finally {
      global.fetch = savedFetch;
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it("reports parked usage and receipts with real aggregate SQL", async () => {
    await mockDatabase.insert(schema.usageEvents).values({ organizationId: orgId, eventType: "playwright_execution", eventName: "playwright_minutes",
      units: "1", unitType: "minutes", billingPeriodStart: new Date(0), billingPeriodEnd: new Date(1000), createdAt: new Date(0) });
    await mockDatabase.insert(schema.executionUsageReceipts).values({ id: randomUUID(), organizationId: orgId, runId: "parked-run", eventType: "playwright_execution",
      units: "1", billingPeriodStart: new Date(0), billingPeriodEnd: new Date(1000), nextAttemptAt: null });
    expect(await getBillingReconciliationStatus()).toMatchObject({ pendingEvents: 1, parkedEvents: 1, pendingReceipts: 1, parkedReceipts: 1, requiresAttention: true });
  });

  it("activates the plan from a snake_case subscription.active and stores the billing period", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    expect(await org()).toMatchObject({
      subscriptionPlan: "pro",
      subscriptionStatus: "active",
      subscriptionId: SUB,
      polarCustomerId: CUS,
    });
    expect((await org()).subscriptionEndsAt?.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect((await org()).subscriptionStartedAt?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("maps the second product to its plan", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription({ product_id: "prod_plus", product: { id: "prod_plus" } }),
      "2026-10-01T00:00:01Z",
    );
    expect((await org()).subscriptionPlan).toBe("plus");
  });

  it("still accepts the previous camelCase delivery shape", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      {
        id: SUB,
        status: "active",
        customerId: CUS,
        productId: "prod_pro",
        currentPeriodStart: "2026-10-01T00:00:00Z",
        currentPeriodEnd: "2026-11-01T00:00:00Z",
        metadata: { referenceId: orgId },
      },
      "2026-10-01T00:00:01Z",
    );
    expect(await org()).toMatchObject({
      subscriptionPlan: "pro",
      subscriptionStatus: "active",
    });
  });

  it("treats a duplicate delivery as a no-op", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    const first = await org();
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    expect(await org()).toEqual(first);
  });

  it("ignores an older event that arrives after a newer one (out of order)", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:10Z",
    );
    await deliver(
      handleSubscriptionCanceled,
      "subscription.canceled",
      subscription({ status: "canceled", cancel_at_period_end: true }),
      "2026-10-01T00:00:05Z",
    );
    expect((await org()).subscriptionStatus).toBe("active");
  });

  it("marks cancel-at-period-end as canceled and uncancel restores it", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    await deliver(
      handleSubscriptionCanceled,
      "subscription.canceled",
      subscription({ status: "active", cancel_at_period_end: true }),
      "2026-10-05T00:00:00Z",
    );
    expect((await org()).subscriptionStatus).toBe("canceled");
    await deliver(
      handleSubscriptionUncanceled,
      "subscription.uncanceled",
      subscription(),
      "2026-10-06T00:00:00Z",
    );
    expect((await org()).subscriptionStatus).toBe("active");
  });

  it("records past_due and then revocation", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    await deliver(
      handleSubscriptionPastDue,
      "subscription.past_due",
      subscription({ status: "past_due" }),
      "2026-10-10T00:00:00Z",
    );
    expect((await org()).subscriptionStatus).toBe("past_due");
    await deliver(
      handleSubscriptionRevoked,
      "subscription.revoked",
      subscription({ status: "canceled", ended_at: "2026-10-12T00:00:00Z" }),
      "2026-10-12T00:00:00Z",
    );
    const revoked = await org();
    expect(revoked.subscriptionStatus).not.toBe("active");
  });

  it("does not let a payload for another customer change this organization", async () => {
    await expect(
      deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({
          customer_id: "cus_attacker",
          customer: { id: "cus_attacker", external_id: "x", metadata: {} },
        }),
        "2026-10-01T00:00:01Z",
      ),
    ).rejects.toThrow("does not match organization billing owner");
    expect(await org()).toMatchObject({ subscriptionStatus: "none" });
    expect((await org(otherOrgId)).subscriptionStatus).toBe("none");
  });

  it("refuses an unknown product instead of guessing a plan", async () => {
    await expect(
      deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({
          product_id: "prod_unknown",
          product: { id: "prod_unknown" },
        }),
        "2026-10-01T00:00:01Z",
      ),
    ).rejects.toThrow("Unknown product ID");
    expect((await org()).subscriptionPlan).toBeNull();
  });

  it("does not trust a spoofed camelCase alias inside metadata to choose the organization", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription({
        metadata: { reference_id: otherOrgId, referenceId: orgId },
      }),
      "2026-10-01T00:00:01Z",
    );
    expect((await org()).subscriptionStatus).toBe("active");
    expect((await org(otherOrgId)).subscriptionStatus).toBe("none");
  });

  it("applies exactly once when the same event is delivered concurrently", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        deliver(
          handleSubscriptionActive,
          "subscription.active",
          subscription(),
          "2026-10-01T00:00:01Z",
        ),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await org()).toMatchObject({
      subscriptionPlan: "pro",
      subscriptionStatus: "active",
    });
    const claims =
      await client`SELECT count(*)::int AS n FROM webhook_idempotency`;
    expect(claims[0].n).toBe(1);
  });

  it.each([
    ["garbage string", "not-a-date"],
    ["empty string", ""],
    ["number", 12345],
    ["object", { a: 1 }],
  ])(
    "does not corrupt billing dates when the period end is a %s",
    async (_name, bad) => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({ current_period_end: bad as never }),
        "2026-10-01T00:00:01Z",
      ).catch(() => undefined);
      const row = await org();
      if (row.subscriptionStatus === "active") {
        // Whatever the handler decided, a stored end date must be a real date.
        expect(
          row.subscriptionEndsAt === null ||
            Number.isFinite(row.subscriptionEndsAt.getTime()),
        ).toBe(true);
      }
    },
  );

  it("rejects an invalid provider timestamp without changing state", async () => {
    await expect(
      deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "not-a-time",
      ),
    ).rejects.toThrow();
    expect((await org()).subscriptionStatus).toBe("none");
  });

  it("fails cleanly, not with a database error, for an unlinked customer whose external id is not a user", async () => {
    await client`UPDATE organization SET polar_customer_id = NULL WHERE id = ${orgId}`;
    await expect(
      deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      ),
    ).rejects.toThrow(/no owner identity|owner/i);
    expect(await org()).toMatchObject({
      subscriptionStatus: "none",
      polarCustomerId: null,
    });
  });

  it("does not bind a customer to an org through a non-owner user id", async () => {
    await client`UPDATE organization SET polar_customer_id = NULL WHERE id = ${orgId}`;
    const stranger = randomUUID();
    await expect(
      deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({
          customer: { id: CUS, external_id: stranger, metadata: {} },
        }),
        "2026-10-01T00:00:01Z",
      ),
    ).rejects.toThrow();
    expect((await org()).polarCustomerId).toBeNull();
  });

  it("fails a conflicting same-instant plan change retryably instead of applying or dropping it", async () => {
    await deliver(
      handleSubscriptionActive,
      "subscription.active",
      subscription(),
      "2026-10-01T00:00:01Z",
    );
    const updated = (productId: string) =>
      subscription({ product_id: productId, product: { id: productId } });
    await deliver(
      handleSubscriptionUpdated,
      "subscription.updated",
      updated("prod_pro"),
      "2026-10-02T00:00:00Z",
    );
    await expect(
      deliver(
        handleSubscriptionUpdated,
        "subscription.updated",
        updated("prod_plus"),
        "2026-10-02T00:00:00Z",
      ),
    ).rejects.toThrow(/Ambiguous Polar event order|reconcile/);
    expect((await org()).subscriptionPlan).toBe("pro");
  });

  describe("customer lifecycle", () => {
    async function makeOwner(organizationId: string) {
      const [u] = await mockDatabase
        .insert(schema.user)
        .values({ name: "Owner", email: `${randomUUID()}@example.com` })
        .returning();
      await mockDatabase.insert(schema.member).values({
        userId: u.id,
        organizationId,
        role: "org_owner",
        createdAt: new Date(),
      });
      return u.id;
    }
    const customer = (over: Record<string, unknown> = {}) => ({
      id: "cus_new",
      external_id: null,
      email: "o@example.com",
      metadata: {},
      ...over,
    });
    beforeEach(async () => {
      await client`UPDATE organization SET polar_customer_id = NULL WHERE id = ${orgId}`;
    });

    it("links a new customer to the organization named in its metadata when the user owns it", async () => {
      const owner = await makeOwner(orgId);
      await deliver(
        handleCustomerCreated,
        "customer.created",
        customer({
          metadata: { referenceId: orgId, userId: owner },
          external_id: `organization:${orgId}`,
        }),
        "2026-10-01T00:00:00Z",
      );
      expect((await org()).polarCustomerId).toBe("cus_new");
    });

    it("links by the user's single owned organization when no reference is given", async () => {
      const owner = await makeOwner(orgId);
      await deliver(
        handleCustomerCreated,
        "customer.created",
        customer({ metadata: { userId: owner } }),
        "2026-10-01T00:00:00Z",
      );
      expect((await org()).polarCustomerId).toBe("cus_new");
    });

    it("does not link when the user is not an owner of the referenced organization", async () => {
      const otherOwner = await makeOwner(otherOrgId);
      await deliver(
        handleCustomerCreated,
        "customer.created",
        customer({ metadata: { referenceId: orgId, userId: otherOwner } }),
        "2026-10-01T00:00:00Z",
      ).catch(() => undefined);
      expect((await org()).polarCustomerId).toBeNull();
    });

    it("does not overwrite an existing customer binding", async () => {
      const owner = await makeOwner(orgId);
      await client`UPDATE organization SET polar_customer_id = 'cus_existing' WHERE id = ${orgId}`;
      await deliver(
        handleCustomerCreated,
        "customer.created",
        customer({ metadata: { referenceId: orgId, userId: owner } }),
        "2026-10-01T00:00:00Z",
      ).catch(() => undefined);
      expect((await org()).polarCustomerId).toBe("cus_existing");
    });

    it("ignores a customer whose external id is an organization reference and has no user id, without a database error", async () => {
      await expect(
        deliver(
          handleCustomerCreated,
          "customer.created",
          customer({
            external_id: `organization:${orgId}`,
            metadata: { referenceId: orgId },
          }),
          "2026-10-01T00:00:00Z",
        ),
      ).resolves.not.toThrow();
      expect((await org()).polarCustomerId).toBeNull();
    });

    it("clears the plan when the customer is deleted and ignores unknown customers", async () => {
      await client`UPDATE organization SET polar_customer_id = ${CUS} WHERE id = ${orgId}`;
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await deliver(
        handleCustomerDeleted,
        "customer.deleted",
        { id: "cus_nobody" },
        "2026-10-02T00:00:00Z",
      );
      expect((await org()).subscriptionStatus).toBe("active");
      await deliver(
        handleCustomerDeleted,
        "customer.deleted",
        { id: CUS },
        "2026-10-03T00:00:00Z",
      );
      expect(await org()).toMatchObject({
        subscriptionStatus: "none",
        subscriptionPlan: null,
      });
    });
  });

  describe("orders", () => {
    const order = (over: Record<string, unknown> = {}) => ({
      id: "ord_1",
      customer_id: CUS,
      product_id: "prod_pro",
      subscription_id: SUB,
      metadata: { referenceId: orgId },
      customer: { id: CUS, external_id: `organization:${orgId}`, metadata: {} },
      ...over,
    });

    it("acknowledges order.created without changing the subscription", async () => {
      await deliver(
        handleOrderCreated,
        "order.created",
        order(),
        "2026-10-01T00:00:00Z",
      );
      expect((await org()).subscriptionStatus).toBe("none");
    });

    it("waits for the lifecycle event instead of applying a payment for an unbound subscription", async () => {
      await expect(
        deliver(handleOrderPaid, "order.paid", order(), "2026-10-01T00:00:05Z"),
      ).rejects.toThrow(/Waiting for subscription lifecycle/);
      expect((await org()).subscriptionStatus).toBe("none");
    });

    it("rolls usage into a new billing period on a renewal payment and keeps the plan", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await client`UPDATE organization SET playwright_minutes_used = 42, ai_credits_used = 7 WHERE id = ${orgId}`;
      await deliver(
        handleOrderPaid,
        "order.paid",
        order({
          current_period_start: "2026-11-01T00:00:00Z",
          current_period_end: "2026-12-01T00:00:00Z",
        }),
        "2026-11-01T00:00:05Z",
      );
      const row = await org();
      expect(row).toMatchObject({
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
      });
      expect(Number(row.playwrightMinutesUsed)).toBe(0);
      expect(row.aiCreditsUsed).toBe(0);
    });

    it("does not reset usage for a payment inside the same billing period", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await client`UPDATE organization SET playwright_minutes_used = 42 WHERE id = ${orgId}`;
      await deliver(
        handleOrderPaid,
        "order.paid",
        order(),
        "2026-10-05T00:00:00Z",
      );
      expect(Number((await org()).playwrightMinutesUsed)).toBe(42);
    });

    it("rejects a payment for an unknown product", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await expect(
        deliver(
          handleOrderPaid,
          "order.paid",
          order({ product_id: "prod_unknown" }),
          "2026-10-05T00:00:00Z",
        ),
      ).rejects.toThrow(/Unknown product/);
    });
  });

  describe("subscription replacement and plan changes", () => {
    it("binds a replacement subscription after revocation and refuses to resurrect the old one", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await deliver(
        handleSubscriptionRevoked,
        "subscription.revoked",
        subscription({ status: "canceled", ended_at: "2026-10-10T00:00:00Z" }),
        "2026-10-10T00:00:00Z",
      );
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({
          id: "sub_2",
          current_period_start: "2026-10-11T00:00:00Z",
          current_period_end: "2026-11-11T00:00:00Z",
        }),
        "2026-10-11T00:00:01Z",
      );
      expect(await org()).toMatchObject({
        subscriptionId: "sub_2",
        subscriptionStatus: "active",
      });
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-12T00:00:00Z",
      ).catch(() => undefined);
      expect((await org()).subscriptionId).toBe("sub_2");
    });

    it("does not let an old subscription replace the current one without a lifecycle activation", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await expect(
        deliver(
          handleSubscriptionUpdated,
          "subscription.updated",
          subscription({ id: "sub_other" }),
          "2026-10-02T00:00:00Z",
        ),
      ).rejects.toThrow();
      expect((await org()).subscriptionId).toBe(SUB);
    });

    it("applies an immediate upgrade", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription({ product_id: "prod_plus", product: { id: "prod_plus" } }),
        "2026-10-01T00:00:01Z",
      );
      await deliver(
        handleSubscriptionUpdated,
        "subscription.updated",
        subscription(),
        "2026-10-02T00:00:00Z",
      );
      expect((await org()).subscriptionPlan).toBe("pro");
    });

    it("keeps the current plan until a scheduled downgrade takes effect", async () => {
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
      await deliver(
        handleSubscriptionUpdated,
        "subscription.updated",
        subscription({
          product_id: "prod_plus",
          product: { id: "prod_plus" },
          pending_update: {
            product_id: "prod_plus",
            applies_at: "2099-01-01T00:00:00Z",
          },
        }),
        "2026-10-02T00:00:00Z",
      );
      expect((await org()).subscriptionPlan).toBe("pro");
    });
  });

  describe("housekeeping", () => {
    it("removes expired webhook claims and keeps unexpired ones", async () => {
      await client`INSERT INTO webhook_idempotency (id, webhook_id, event_type, expires_at) VALUES (${randomUUID()}, 'old', 'x', now() - interval '1 day'), (${randomUUID()}, 'new', 'x', now() + interval '1 day')`;
      expect(await cleanupExpiredWebhooks()).toBe(1);
      const left =
        await client`SELECT webhook_id FROM webhook_idempotency ORDER BY webhook_id`;
      expect(left.map((r) => r.webhook_id)).toEqual(["new"]);
    });
  });

  describe("invalid events never change an active organization", () => {
    const handlers: Array<[string, Handler, string]> = [
      ["subscription.active", handleSubscriptionActive, "subscription.active"],
      [
        "subscription.updated",
        handleSubscriptionUpdated,
        "subscription.updated",
      ],
      [
        "subscription.canceled",
        handleSubscriptionCanceled,
        "subscription.canceled",
      ],
      [
        "subscription.uncanceled",
        handleSubscriptionUncanceled,
        "subscription.uncanceled",
      ],
      [
        "subscription.revoked",
        handleSubscriptionRevoked,
        "subscription.revoked",
      ],
      [
        "subscription.past_due",
        handleSubscriptionPastDue,
        "subscription.past_due",
      ],
    ];
    const snapshot = async () => {
      const row = await org();
      return { ...row };
    };
    let minute = 10;
    const nextAt = () =>
      `2026-10-01T00:${String(minute++).padStart(2, "0")}:00Z`;

    beforeEach(async () => {
      minute = 10;
      await deliver(
        handleSubscriptionActive,
        "subscription.active",
        subscription(),
        "2026-10-01T00:00:01Z",
      );
    });

    const bad: Array<[string, Record<string, unknown>]> = [
      [
        "no subscription id",
        { id: undefined, subscription: undefined, subscription_id: undefined },
      ],
      [
        "another customer",
        {
          customer_id: "cus_other_tenant",
          customer: { id: "cus_other_tenant", external_id: "x", metadata: {} },
        },
      ],
      [
        "an unknown organization and customer",
        {
          customer_id: "cus_ghost",
          metadata: { referenceId: randomUUID() },
          customer: { id: "cus_ghost", external_id: "x", metadata: {} },
        },
      ],
      [
        "an unknown product",
        { product_id: "prod_unknown", product: { id: "prod_unknown" } },
      ],
      ["no customer", { customer_id: undefined, customer: undefined }],
    ];

    // canceled/revoked locate the organization by the subscription id (a unique key),
    // so a payload that merely repeats it with other fields is the same subscription.
    // The meaningful hostile case for them is a different subscription that only
    // points at this organization through metadata.
    const foreign = { id: "sub_foreign" };
    describe.each(handlers)("%s", (_label, handler, type) => {
      const subscriptionKeyed =
        type === "subscription.canceled" || type === "subscription.revoked";
      it.each(bad)("with %s", async (_name, rawOver) => {
        const over =
          subscriptionKeyed && !("id" in rawOver)
            ? { ...foreign, ...rawOver }
            : rawOver;
        const before = await snapshot();
        await deliver(handler, type, subscription(over), nextAt()).catch(
          () => undefined,
        );
        const after = await snapshot();
        expect(after.subscriptionStatus).toBe(before.subscriptionStatus);
        expect(after.subscriptionPlan).toBe(before.subscriptionPlan);
        expect(after.subscriptionId).toBe(before.subscriptionId);
        expect(after.polarCustomerId).toBe(before.polarCustomerId);
        expect(after.subscriptionEndsAt).toEqual(before.subscriptionEndsAt);
        expect((await org(otherOrgId)).subscriptionStatus).toBe("none");
      });
    });

    it("acknowledges subscription.created without granting access", async () => {
      await client`UPDATE organization SET subscription_status = 'none', subscription_plan = NULL, subscription_id = NULL WHERE id = ${orgId}`;
      await deliver(
        handleSubscriptionCreated,
        "subscription.created",
        subscription({ id: "sub_new", status: "incomplete" }),
        nextAt(),
      );
      expect(await org()).toMatchObject({
        subscriptionStatus: "none",
        subscriptionPlan: null,
      });
    });

    it("rejects the same bad events for payment handlers without touching usage", async () => {
      await client`UPDATE organization SET playwright_minutes_used = 11 WHERE id = ${orgId}`;
      for (const over of [
        {
          customer_id: "cus_other_tenant",
          customer: { id: "cus_other_tenant", external_id: "x", metadata: {} },
        },
        { product_id: "prod_unknown" },
        { subscription_id: "sub_foreign" },
        { subscription_id: undefined },
      ]) {
        await deliver(
          handleOrderPaid,
          "order.paid",
          {
            id: "ord_x",
            customer_id: CUS,
            product_id: "prod_pro",
            subscription_id: SUB,
            metadata: { referenceId: orgId },
            customer: {
              id: CUS,
              external_id: `organization:${orgId}`,
              metadata: {},
            },
            current_period_start: "2027-01-01T00:00:00Z",
            ...over,
          },
          nextAt(),
        ).catch(() => undefined);
      }
      expect(Number((await org()).playwrightMinutesUsed)).toBe(11);
      expect((await org()).subscriptionStatus).toBe("active");
    });
  });
});
