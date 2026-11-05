/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `drop_legacy_columns_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const statements = readFileSync(join(__dirname, "0056_drop_legacy_plan_and_subscriber_columns.sql"), "utf8").split(
  "--> statement-breakpoint",
);
const migrate = async () => {
  for (const statement of statements) await client.unsafe(statement);
};
const columns = async (table: string) =>
  (await client<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`).map(
    (row) => row.column_name,
  );

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await client.unsafe(`
    CREATE TABLE plan_limits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sso_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE status_page_subscribers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      unsubscribe_token varchar(255), webhook_secret varchar(255), webhook_secret_encrypted text
    );
    CREATE INDEX status_page_subscribers_unsubscribe_token_idx ON status_page_subscribers (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;
  `);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("refuses to drop webhook_secret while a plaintext secret has no encrypted copy", async () => {
  await client`INSERT INTO status_page_subscribers (webhook_secret) VALUES ('plain')`;
  await expect(migrate()).rejects.toThrow(/1 status page webhook subscribers still have a plaintext signing secret/);
  expect(await columns("status_page_subscribers")).toContain("webhook_secret");
});

it("drops the plaintext secret and sso_enabled once every secret is encrypted, keeping the legacy unsubscribe token", async () => {
  await client`UPDATE status_page_subscribers SET webhook_secret_encrypted = 'enc:v1:x'`;
  await client`INSERT INTO status_page_subscribers (unsubscribe_token) VALUES ('t')`;
  await migrate();
  expect(await columns("status_page_subscribers")).toEqual(expect.arrayContaining(["id", "webhook_secret_encrypted"]));
  expect(await columns("status_page_subscribers")).toContain("unsubscribe_token");
  expect(await columns("status_page_subscribers")).not.toContain("webhook_secret");
  expect(await columns("plan_limits")).not.toContain("sso_enabled");
  const [{ count }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_indexes WHERE indexname = 'status_page_subscribers_unsubscribe_token_idx'`;
  expect(count).toBe(1);
});

it("is re-runnable once the columns are gone", async () => {
  await migrate();
});
