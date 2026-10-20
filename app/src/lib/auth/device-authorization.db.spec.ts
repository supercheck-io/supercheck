/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));

// The real better-auth instance eagerly binds the DB at import time.
jest.mock("@/utils/auth", () => ({ auth: { api: {} } }));
jest.mock("@/lib/session", () => ({}));

import {
  DEVICE_CLIENT_ID,
  approveDeviceGrant,
  createDeviceGrant,
  denyDeviceGrant,
  exchangeDeviceCode,
  hashDeviceCode,
  normalizeUserCode,
} from "./device-authorization";
import {
  MAX_CLI_TOKENS_PER_PROJECT,
  issueCliApiKeyAtomically,
} from "./cli-key-service";

const execFileAsync = promisify(execFile);
const dbName = `device_auth_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

let orgId: string;
let projectId: string;
let ownerId: string;
let viewerId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  process.env.BETTER_AUTH_SECRET = "test-secret-for-device-auth-hmac";
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: target.toString(),
      SELF_HOSTED: "true",
      NODE_ENV: "test",
    },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  await client`TRUNCATE device_authorizations, apikey, organization, "user" CASCADE`;
  const [org] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Org", createdAt: new Date() })
    .returning();
  const [project] = await mockDatabase
    .insert(schema.projects)
    .values({ organizationId: org.id, name: "Project" })
    .returning();
  const [owner] = await mockDatabase
    .insert(schema.user)
    .values({ name: "Owner", email: `${randomUUID()}@example.com` })
    .returning();
  const [viewer] = await mockDatabase
    .insert(schema.user)
    .values({ name: "Viewer", email: `${randomUUID()}@example.com` })
    .returning();
  await mockDatabase.insert(schema.member).values([
    { organizationId: org.id, userId: owner.id, role: "org_owner", createdAt: new Date() },
    { organizationId: org.id, userId: viewer.id, role: "project_viewer", createdAt: new Date() },
  ]);
  orgId = org.id;
  projectId = project.id;
  ownerId = owner.id;
  viewerId = viewer.id;
});

const keyCount = async () =>
  (
    await mockDatabase
      .select({ id: schema.apikey.id })
      .from(schema.apikey)
      .where(and(eq(schema.apikey.projectId, projectId), isNull(schema.apikey.jobId)))
  ).length;

const newGrant = (now?: Date) =>
  createDeviceGrant({
    clientId: DEVICE_CLIENT_ID,
    metadata: { hostname: "laptop", clientName: "supercheck-cli" },
    now,
  });

describe("shared CLI key issuance", () => {
  const input = (name: string) => ({
    userId: ownerId,
    organizationId: orgId,
    projectId,
    name,
    expiresInSeconds: null,
  });

  it("never exceeds the per-project cap under concurrent issuance", async () => {
    for (let i = 0; i < MAX_CLI_TOKENS_PER_PROJECT - 1; i++) {
      expect((await issueCliApiKeyAtomically(input(`seed-${i}`))).ok).toBe(true);
    }
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => issueCliApiKeyAtomically(input(`race-${i}`))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "limit_reached")).toHaveLength(5);
    expect(await keyCount()).toBe(MAX_CLI_TOKENS_PER_PROJECT);
  });

  it("serialises duplicate names", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => issueCliApiKeyAtomically(input("same-name"))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "name_conflict")).toHaveLength(3);
  });

  it("stores only a hash of the key", async () => {
    const result = await issueCliApiKeyAtomically(input("hash-check"));
    if (!result.ok) throw new Error("expected key");
    const [row] = await mockDatabase.select().from(schema.apikey);
    expect(row.key).not.toBe(result.key.plaintext);
    expect(result.key.plaintext).toMatch(/^sck_live_/);
  });
});

describe("device authorization lifecycle", () => {
  it("stores hashed codes only", async () => {
    const grant = await newGrant();
    const [row] = await mockDatabase.select().from(schema.deviceAuthorizations);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(grant.deviceCode);
    expect(serialized).not.toContain(grant.userCode.replace("-", ""));
    expect(row.deviceCodeHash).toBe(hashDeviceCode(grant.deviceCode));
  });

  it("returns authorization_pending, then slow_down when polled too fast", async () => {
    const t0 = new Date();
    const grant = await newGrant(t0);
    const poll = (offsetMs: number) =>
      exchangeDeviceCode({
        deviceCode: grant.deviceCode,
        clientId: DEVICE_CLIENT_ID,
        now: new Date(t0.getTime() + offsetMs),
      });
    expect(await poll(1000)).toMatchObject({ ok: false, error: "authorization_pending" });
    expect(await poll(2000)).toMatchObject({ ok: false, error: "slow_down", interval: 10 });
    expect(await poll(20000)).toMatchObject({ ok: false, error: "authorization_pending" });
  });

  it("mints exactly one key on approval + concurrent exchange", async () => {
    const grant = await newGrant();
    expect(
      await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId }),
    ).toEqual({ ok: true });
    expect(await keyCount()).toBe(0); // approval is consent only

    const results = await Promise.all([
      exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
      exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results.find((r) => r.ok);
    if (!winner || !winner.ok) throw new Error("no winner");
    expect(winner.accessToken).toMatch(/^sck_live_/);
    expect(winner.context.project.id).toBe(projectId);
    expect(winner.expiresIn).toBeGreaterThan(89 * 24 * 3600);
    expect(await keyCount()).toBe(1);

    const [row] = await mockDatabase.select().from(schema.deviceAuthorizations);
    expect(row.status).toBe("consumed");
    expect(row.apiKeyId).not.toBeNull();

    // A consumed grant can never be exchanged again.
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await keyCount()).toBe(1);
  });

  it("rolls back consumption when the project key cap blocks issuance", async () => {
    for (let i = 0; i < MAX_CLI_TOKENS_PER_PROJECT; i++) {
      await issueCliApiKeyAtomically({
        userId: ownerId,
        organizationId: orgId,
        projectId,
        name: `seed-${i}`,
      });
    }
    const grant = await newGrant();
    await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId });
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "token_limit_reached" });
    const [row] = await mockDatabase.select().from(schema.deviceAuthorizations);
    expect(row.status).toBe("approved"); // still retryable after the user frees a slot
  });

  it("rejects expired grants at exchange and approval", async () => {
    const past = new Date(Date.now() - 20 * 60 * 1000);
    const grant = await newGrant(past);
    expect(
      await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "expired_token" });
  });

  it("denied grants cannot be approved or exchanged", async () => {
    const grant = await newGrant();
    expect(await denyDeviceGrant({ userCode: grant.userCode })).toEqual({ ok: true });
    expect(
      await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId }),
    ).toEqual({ ok: false, reason: "not_pending" });
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "access_denied" });
  });

  it("blocks users without apiKey:create and burns the grant after repeated probing", async () => {
    const grant = await newGrant();
    for (let i = 0; i < 5; i++) {
      expect(
        await approveDeviceGrant({ userCode: grant.userCode, userId: viewerId, projectId }),
      ).toEqual({ ok: false, reason: "forbidden" });
    }
    const [row] = await mockDatabase.select().from(schema.deviceAuthorizations);
    expect(row.status).toBe("denied");
    expect(
      await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId }),
    ).toEqual({ ok: false, reason: "not_pending" });
  });

  it("refuses issuance if access was revoked between approval and exchange", async () => {
    const grant = await newGrant();
    await approveDeviceGrant({ userCode: grant.userCode, userId: ownerId, projectId });
    await mockDatabase
      .update(schema.member)
      .set({ role: "project_viewer" })
      .where(eq(schema.member.userId, ownerId));
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "access_denied" });
    expect(await keyCount()).toBe(0);
  });

  it("rejects the wrong client and unknown device codes", async () => {
    const grant = await newGrant();
    expect(
      await exchangeDeviceCode({ deviceCode: grant.deviceCode, clientId: "other" }),
    ).toMatchObject({ ok: false, error: "invalid_client" });
    expect(
      await exchangeDeviceCode({ deviceCode: "nope", clientId: DEVICE_CLIENT_ID }),
    ).toMatchObject({ ok: false, error: "invalid_grant" });
  });
});

describe("connection pool safety", () => {
  it("does not self-deadlock concurrent exchanges on a 2-connection pool", async () => {
    const tiny = postgres(process.env.TEST_DATABASE_URL!.replace(/\/[^/]*$/, `/${dbName}`), {
      max: 2,
      onnotice: () => {},
    });
    const original = mockDatabase;
    mockDatabase = drizzle(tiny, { schema });
    try {
      const a = await newGrant();
      const b = await newGrant();
      await approveDeviceGrant({ userCode: a.userCode, userId: ownerId, projectId });
      await approveDeviceGrant({ userCode: b.userCode, userId: ownerId, projectId });
      const results = await Promise.race([
        Promise.all([
          exchangeDeviceCode({ deviceCode: a.deviceCode, clientId: DEVICE_CLIENT_ID }),
          exchangeDeviceCode({ deviceCode: b.deviceCode, clientId: DEVICE_CLIENT_ID }),
        ]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pool deadlock")), 10_000)),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);
    } finally {
      mockDatabase = original;
      await tiny.end({ timeout: 5 });
    }
  }, 20_000);
});

describe("user code normalisation", () => {
  it("accepts case/hyphen/space variants and rejects ambiguous characters", () => {
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
    expect(normalizeUserCode("BCDF GHJK")).toBe("BCDFGHJK");
    expect(normalizeUserCode("BCDF-GHJ0")).toBeNull(); // 0 excluded
    expect(normalizeUserCode("BCDF-GHJ")).toBeNull();
    expect(normalizeUserCode("A".repeat(100))).toBeNull();
  });
});
