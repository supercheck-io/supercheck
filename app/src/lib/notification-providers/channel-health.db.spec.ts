/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
// Test sends live in Redis; none here, so health comes from alert_history alone.
jest.mock("./health", () => ({ ...jest.requireActual("./health"), loadProviderTestHealth: async () => new Map() }));
import { loadProviderHealth } from "./channel-health";

const databaseName = `channel_health_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const insert = (provider: string, status: string, sentAt: string | null, metadata: unknown = null) =>
  client`INSERT INTO alert_history (id, provider, status, sent_at, delivery_metadata) VALUES (${randomUUID()}, ${provider}, ${status}, ${sentAt}, ${metadata ? JSON.stringify(metadata) : null}::jsonb)`;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  mockDatabase = drizzle(client);
  // Only the columns the query reads, plus both indexes the planner chooses between.
  await client.unsafe(`CREATE TABLE alert_history (id uuid PRIMARY KEY, provider varchar(100) NOT NULL, status varchar(50) NOT NULL,
    sent_at timestamptz DEFAULT now(), delivery_metadata jsonb);
    CREATE INDEX alert_history_sent_at_idx ON alert_history (sent_at);`);
  const migration = readFileSync(path.join(__dirname, "../../db/migrations/0087_alert_history_provider_sent_at_idx.sql"), "utf8");
  await client.unsafe(migration);
}, 30_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("reads the newest dated alert per channel, ignores undated rows and skips unused channels", async () => {
  await insert("busy", "failed", ago(60));
  const newest = ago(5);
  await insert("busy", "sent", newest);
  await insert("busy", "failed", null); // undated: sorts first under plain DESC, must not count as newest
  await insert("auth", "failed", ago(10), { delivery: { responseStatus: 401 } });
  await insert("stale", "sent", ago(8 * 24 * 60));

  const { health, lastUsed } = await loadProviderHealth(["busy", "auth", "stale", "unused"]);
  expect(lastUsed.get("busy")?.toISOString()).toBe(newest);
  expect(health.get("busy")).toMatchObject({ state: "ok" });
  expect(health.get("auth")).toMatchObject({ state: "auth_failed" });
  expect(lastUsed.has("stale")).toBe(true);
  expect(health.get("stale")).toEqual({ state: "unknown", at: null }); // older than 7 days
  expect(lastUsed.has("unused")).toBe(false);
  expect(health.get("unused")).toEqual({ state: "unknown", at: null });
});

it("probes the provider index for a quiet channel instead of walking sent_at across the table", async () => {
  await client.unsafe(`INSERT INTO alert_history (id, provider, status, sent_at)
    SELECT gen_random_uuid(), 'loud-' || (g % 20), 'sent', now() - g * interval '1 second' FROM generate_series(1, 50000) g;
    INSERT INTO alert_history (id, provider, status, sent_at) VALUES (gen_random_uuid(), 'quiet', 'sent', now() - interval '300 days');
    ANALYZE alert_history;`);
  const explain = jest.spyOn(mockDatabase, "execute");
  await loadProviderHealth(["quiet", "never", "loud-1"]);
  const query = explain.mock.calls[0][0];
  explain.mockRestore();
  const { sql: text, params } = new PgDialect().sqlToQuery(query as never);
  const plan = (await client.unsafe(`EXPLAIN (FORMAT JSON) ${text}`, params as never[]))[0]["QUERY PLAN"];
  const json = JSON.stringify(plan);
  expect(json).toContain("alert_history_provider_sent_at_idx");
  expect(json).not.toContain('"alert_history_sent_at_idx"');
  expect(json).not.toContain('"Sort"');
});
