/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// Upgrade from a database at migration 0067 that already holds alert_history rows: 0068 and 0069 add the claim
// columns and the partial unique index (empty, because old rows have NULL keys), widens the alert type check
// for ssl_renewed, and 0070 drops the unused monitors.muted_until.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `alert_claims_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

const migrate = (cwd: string) =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 120_000,
  });
const monitorId = randomUUID();
const outageKey = randomUUID();
const insertAlert = (over: Record<string, unknown> = {}) => {
  const row = {
    id: randomUUID(),
    type: "monitor_failure",
    message: "m",
    target: "API",
    target_type: "monitor",
    monitor_id: monitorId,
    provider: "provider-1",
    status: "pending",
    ...over,
  };
  return client`INSERT INTO alert_history ${client(row as Record<string, string>)}`;
};
const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
    return "accepted";
  } catch (error) {
    return (error as { code: string }).code;
  }
};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  const work = mkdtempSync(path.join(os.tmpdir(), "upgrade-0067-"));
  try {
    cpSync(path.join(APP_ROOT, "src/db/migrations"), path.join(work, "src/db/migrations"), {
      recursive: true,
      filter: (src) => !/\/00(6[8-9]|[7-9]\d)_[^/]*\.sql$/.test(src),
    });
    await migrate(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  await client.unsafe(`
    INSERT INTO organization (id, name, created_at) VALUES ('00000000-0000-0000-0000-0000000000f1', 'o', now());
    INSERT INTO projects (id, organization_id, name) VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'p');
    INSERT INTO monitors (id, organization_id, project_id, name, type, target, muted_until)
      VALUES ('${monitorId}', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'API', 'http_request', 'https://example.com', now());
  `);
  // Rows an older worker wrote: repeated (monitor, type, provider) with no key.
  await insertAlert({ status: "sent" });
  await insertAlert({ status: "sent" });
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("upgrades a populated alert_history: keeps old rows, adds an empty valid claim index, and drops muted_until", async () => {
  await migrate(APP_ROOT);
  const columns = (await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'alert_history'`).map((r) => r.column_name);
  expect(columns).toEqual(expect.arrayContaining(["outage_key", "alert_ordinal", "claim_attempts"]));
  const [index] = await client`SELECT i.indisvalid AS valid, i.indisunique AS "unique", pg_get_expr(i.indpred, i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'alert_history_monitor_claim_uidx'`;
  expect(index).toMatchObject({ valid: true, unique: true });
  expect(index.predicate).toMatch(/outage_key IS NOT NULL/);
  // Built by 0069 outside the migration transaction, and recorded only after it succeeded.
  const hash0069 = createHash("md5")
    .update(readFileSync(path.join(APP_ROOT, "src/db/migrations/0069_monitor_alert_claim_index.sql"), "utf8"))
    .digest("hex");
  expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${hash0069}`).toHaveLength(1);
  expect(await client`SELECT 1 FROM alert_history`).toHaveLength(2);
  expect(await client`SELECT 1 FROM alert_history WHERE outage_key IS NOT NULL`).toHaveLength(0);
  // 0070 drops the unused column (the seeded monitor had a value in it); the monitor row itself survives.
  const [{ present }] = await client`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monitors' AND column_name = 'muted_until') AS present`;
  expect(present).toBe(false);
  expect(await client`SELECT 1 FROM monitors WHERE id = ${monitorId}`).toHaveLength(1);
}, 180_000);

it("claims one row per (monitor, outage, type, ordinal, provider); NULL-key rows never conflict", async () => {
  const claim = (over: Record<string, unknown> = {}) =>
    insertAlert({ outage_key: outageKey, alert_ordinal: 0, claim_attempts: 1, ...over });
  await claim();
  expect(await codeOf(claim())).toBe("23505");
  // A different provider, ordinal, type, or outage is a different claim.
  expect(await codeOf(claim({ provider: "provider-2" }))).toBe("accepted");
  expect(await codeOf(claim({ alert_ordinal: 1 }))).toBe("accepted");
  expect(await codeOf(claim({ type: "monitor_recovery" }))).toBe("accepted");
  expect(await codeOf(claim({ outage_key: randomUUID() }))).toBe("accepted");
  // Rows without a key or ordinal stay outside the index, however often they repeat.
  expect(await codeOf(insertAlert())).toBe("accepted");
  expect(await codeOf(insertAlert({ outage_key: outageKey }))).toBe("accepted");
  expect(await codeOf(insertAlert({ outage_key: outageKey }))).toBe("accepted");
});

it("accepts ssl_renewed and still rejects an unknown alert type", async () => {
  expect(await codeOf(insertAlert({ type: "ssl_renewed", status: "sent" }))).toBe("accepted");
  expect(await codeOf(insertAlert({ type: "ssl_expiring", status: "sent" }))).toBe("accepted");
  expect(await codeOf(insertAlert({ type: "made_up" }))).toBe("23514");
});

it("a second deploy is a no-op", async () => {
  await migrate(APP_ROOT);
  const [{ count }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_indexes WHERE indexname = 'alert_history_monitor_claim_uidx'`;
  expect(count).toBe(1);
});
