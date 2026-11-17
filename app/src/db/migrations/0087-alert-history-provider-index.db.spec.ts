/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const INDEX = "alert_history_provider_sent_at_idx";
const FILE = "src/db/migrations/0087_alert_history_provider_sent_at_idx.sql";
const databaseName = `alert_hist_prov_idx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

const migrate = () =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });

const fileHash = () => createHash("md5").update(readFileSync(path.join(APP_ROOT, FILE), "utf8")).digest("hex");

const indexState = async () =>
  (await client<{ valid: boolean }[]>`
    SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ${INDEX}
  `).map((row) => row.valid);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
}, 30_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("builds (provider, sent_at DESC) outside the migration transaction and records the file once", async () => {
  await migrate();
  expect(await indexState()).toEqual([true]);
  const [{ indexdef }] = await client<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = ${INDEX}`;
  expect(indexdef).toContain("ON public.alert_history USING btree (provider, sent_at DESC)");
  expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${fileHash()}`).toHaveLength(1);
  const [{ count }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM "__drizzle_migrations"`;
  await migrate(); // a second deploy is a no-op
  expect(await indexState()).toEqual([true]);
  const [{ count: again }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM "__drizzle_migrations"`;
  expect(again).toBe(count);
}, 180_000);

it("drops an INVALID index left by an interrupted build and rebuilds it", async () => {
  await migrate(); // self-contained: do not rely on the earlier test having migrated this database
  await client.unsafe(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${INDEX}'::regclass`);
  await client`DELETE FROM "__drizzle_migrations" WHERE hash = ${fileHash()}`;
  expect(await indexState()).toEqual([false]);

  await migrate();
  expect(await indexState()).toEqual([true]);
  expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${fileHash()}`).toHaveLength(1);
}, 180_000);
