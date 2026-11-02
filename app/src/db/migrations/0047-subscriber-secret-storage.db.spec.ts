/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

process.env.SECRET_ENCRYPTION_KEY ??= "test-secret-encryption-key-0123456789abcdef";
const databaseName = `subscriber_secrets_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let mockDb: ReturnType<typeof drizzle>;

jest.mock("@/utils/db", () => ({
  get db() {
    return mockDb;
  },
}));

import { eq } from "drizzle-orm";
import { statusPageSubscribers } from "@/db/schema";
import { verifySubscriber } from "@/actions/verify-subscriber";
import { getSubscriberByToken } from "@/actions/unsubscribe-from-status-page";
import {
  encryptWebhookSecret,
  hashVerificationToken,
  resolveWebhookSecret,
  signUnsubscribeToken,
} from "@/lib/subscriber-tokens";

// The runner rewrites CREATE [UNIQUE] INDEX to IF NOT EXISTS; mirror that for the re-run check.
const migration = readFileSync(join(__dirname, "0047_subscriber_secret_storage.sql"), "utf8").replace(
  /CREATE (UNIQUE )?INDEX "/g,
  'CREATE $1INDEX IF NOT EXISTS "',
);
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const legacyVerify = "a".repeat(64);
const hashedVerify = "b".repeat(64);
const legacyUnsub = "c".repeat(64);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  mockDb = drizzle(client, { schema });
  // Pre-migration shape of the table (only the columns this test touches).
  await client.unsafe(`
    CREATE TABLE status_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar DEFAULT 'p', language varchar DEFAULT 'en', organization_id uuid);
    CREATE TABLE status_page_subscribers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status_page_id uuid NOT NULL REFERENCES status_pages(id),
      email varchar(255), endpoint varchar(500), mode varchar(50) NOT NULL DEFAULT 'email',
      purge_at timestamp, verified_at timestamp, quarantined_at timestamp, skip_confirmation_notification boolean DEFAULT false,
      webhook_verification_token_hash varchar(64), webhook_verification_expires_at timestamp, webhook_failures integer DEFAULT 0,
      webhook_last_attempt_at timestamp, webhook_last_error text,
      verification_token varchar(255), unsubscribe_token varchar(255), webhook_secret varchar(255),
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    );
  `);
  await client.unsafe(`INSERT INTO status_pages (id) VALUES ('00000000-0000-0000-0000-000000000001')`);
  await client.unsafe(`
    INSERT INTO status_page_subscribers (id, status_page_id, email, verification_token, unsubscribe_token, webhook_secret) VALUES
    ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','a@example.test','${legacyVerify}','${legacyUnsub}','plain-secret'),
    ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','b@example.test',NULL,NULL,NULL)
  `);
  for (const stmt of migration.split("--> statement-breakpoint")) await client.unsafe(stmt);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

const A1 = "00000000-0000-0000-0000-0000000000a1";

describe("0047 subscriber secret storage", () => {
  it("backfills the hash and clears the plaintext verification token", async () => {
    const [row] = await client`SELECT verification_token, verification_token_hash, unsubscribe_token, webhook_secret FROM status_page_subscribers WHERE id = ${A1}`;
    expect(row.verification_token).toBeNull();
    expect(row.verification_token_hash).toBe(sha(legacyVerify));
    // Not backfillable in SQL: the app encrypts the secret on first use.
    expect(row.webhook_secret).toBe("plain-secret");
    expect(row.unsubscribe_token).toBe(legacyUnsub);
  });

  it("verifies by hash after the backfill", async () => {
    await mockDb.update(statusPageSubscribers).set({ verifiedAt: new Date() }).where(eq(statusPageSubscribers.id, A1));
    const result = await verifySubscriber(legacyVerify);
    expect(result).toMatchObject({ success: true, alreadyVerified: true });
  });

  it("verifies a plaintext token written by an older app and migrates it", async () => {
    await client`UPDATE status_page_subscribers SET verification_token = ${hashedVerify}, verification_token_hash = NULL, verified_at = now() WHERE id = '00000000-0000-0000-0000-0000000000a2'`;
    expect(await verifySubscriber(hashedVerify)).toMatchObject({ success: true });
    const [row] = await client`SELECT verification_token, verification_token_hash FROM status_page_subscribers WHERE id = '00000000-0000-0000-0000-0000000000a2'`;
    expect(row.verification_token).toBeNull();
    expect(row.verification_token_hash).toBe(hashVerificationToken(hashedVerify));
  });

  it("resolves both legacy and signed unsubscribe links", async () => {
    expect((await getSubscriberByToken(legacyUnsub)).subscriber?.id).toBe(A1);
    expect((await getSubscriberByToken(signUnsubscribeToken(A1))).subscriber?.id).toBe(A1);
    const forged = `${A1}.${"A".repeat(43)}`;
    expect((await getSubscriberByToken(forged)).success).toBe(false);
  });

  it("rejects a duplicate verification hash", async () => {
    await expect(
      client`UPDATE status_page_subscribers SET verification_token_hash = ${sha(legacyVerify)} WHERE id = '00000000-0000-0000-0000-0000000000a2'`,
    ).rejects.toThrow();
  });

  it("round-trips an encrypted webhook secret and migrates a plaintext one", async () => {
    const [legacy] = await mockDb.select().from(statusPageSubscribers).where(eq(statusPageSubscribers.id, A1));
    expect(await resolveWebhookSecret(legacy)).toBe("plain-secret");
    const [migrated] = await client`SELECT webhook_secret, webhook_secret_encrypted FROM status_page_subscribers WHERE id = ${A1}`;
    expect(migrated.webhook_secret).toBeNull();
    expect(migrated.webhook_secret_encrypted).toMatch(/^enc:v1:/);
    expect(migrated.webhook_secret_encrypted).not.toContain("plain-secret");

    const [again] = await mockDb.select().from(statusPageSubscribers).where(eq(statusPageSubscribers.id, A1));
    expect(await resolveWebhookSecret(again)).toBe("plain-secret");

    await mockDb.update(statusPageSubscribers).set({ webhookSecretEncrypted: encryptWebhookSecret("rotated") }).where(eq(statusPageSubscribers.id, A1));
    const [rotated] = await mockDb.select().from(statusPageSubscribers).where(eq(statusPageSubscribers.id, A1));
    expect(await resolveWebhookSecret(rotated)).toBe("rotated");
  });

  it("does not overwrite a secret rotated after the legacy value was read", async () => {
    await client`UPDATE status_page_subscribers SET webhook_secret = 'stale', webhook_secret_encrypted = NULL WHERE id = ${A1}`;
    const [staleRead] = await mockDb.select().from(statusPageSubscribers).where(eq(statusPageSubscribers.id, A1));
    await mockDb
      .update(statusPageSubscribers)
      .set({ webhookSecretEncrypted: encryptWebhookSecret("fresh"), webhookSecret: null })
      .where(eq(statusPageSubscribers.id, A1));
    await resolveWebhookSecret(staleRead);
    const [current] = await mockDb.select().from(statusPageSubscribers).where(eq(statusPageSubscribers.id, A1));
    expect(await resolveWebhookSecret(current)).toBe("fresh");
  });

  it("is re-runnable", async () => {
    for (const stmt of migration.split("--> statement-breakpoint")) await client.unsafe(stmt);
  });
});
