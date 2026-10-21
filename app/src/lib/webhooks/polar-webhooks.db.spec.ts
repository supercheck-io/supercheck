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
} from "./polar-webhooks";
import { normalizePolarPayload } from "./polar-payload";

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
});
