/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// Upgrade from a 1.5.0-shaped database: runs the real migrator up to 0055, adds a webhook subscriber that
// holds only a plaintext signing secret then runs the full migrator.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

process.env.SECRET_ENCRYPTION_KEY ??= "test-secret-encryption-key-0123456789abcdef";
const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `legacy_sub_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

import { resolveWebhookSecret } from "@/lib/subscriber-tokens";

const migrate = (cwd: string, env: Record<string, string> = {}) =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test", ...env },
    timeout: 120_000,
  });
const md5 = (file: string) => createHash("md5").update(readFileSync(path.join(APP_ROOT, "src/db/migrations", file), "utf8")).digest("hex");
const file0056 = readdirSync(path.join(APP_ROOT, "src/db/migrations")).find((f) => f.startsWith("0056_"))!;

const PAGE = "00000000-0000-0000-0000-000000000001";
const HOOK = "00000000-0000-0000-0000-0000000000b1";
const MAIL = "00000000-0000-0000-0000-0000000000b2";

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  // 1.5.0-era database: every migration before 0056.
  const work = mkdtempSync(path.join(os.tmpdir(), "upgrade-0055-"));
  try {
    const dir = path.join(work, "src/db/migrations");
    cpSync(path.join(APP_ROOT, "src/db/migrations"), dir, { recursive: true, filter: (src) => !/\/00(5[6-9]|[6-9]\d)_[^/]*\.sql$/.test(src) });
    await migrate(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  await client.unsafe(`
    INSERT INTO organization (id, name, slug, created_at) VALUES ('00000000-0000-0000-0000-0000000000f1', 'o', 'o-legacy', now());
    INSERT INTO status_pages (id, organization_id, name, subdomain) VALUES ('${PAGE}', '00000000-0000-0000-0000-0000000000f1', 'p', 'legacy-sub');
    INSERT INTO status_page_subscribers (id, status_page_id, endpoint, mode, webhook_secret, unsubscribe_token) VALUES
      ('${HOOK}', '${PAGE}', 'https://example.test/hook', 'webhook', 'whsec_plaintext_from_1_5_0', NULL),
      ('${MAIL}', '${PAGE}', NULL, 'email', NULL, 'legacy-unsubscribe-token');
    UPDATE status_page_subscribers SET email = id || '@example.test' WHERE mode = 'email';
  `);
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("aborts with an actionable message, and rolls back, when the encryption key is missing", async () => {
  const failure = await migrate(APP_ROOT, { SECRET_ENCRYPTION_KEY: "" }).then(() => null, (e) => e);
  expect(failure).not.toBeNull();
  expect(String(failure.stdout) + String(failure.stderr)).toMatch(/SECRET_ENCRYPTION_KEY is missing/);
  const [{ present }] = await client`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'status_page_subscribers' AND column_name = 'webhook_secret') AS present`;
  expect(present).toBe(true);
  expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${md5(file0056)}`).toHaveLength(0);
}, 180_000);

it("upgrades: the plaintext secret is encrypted before 0056 drops it, and the legacy unsubscribe token column is dropped", async () => {
  await migrate(APP_ROOT);
  const [row] = await client`SELECT webhook_secret_encrypted FROM status_page_subscribers WHERE id = ${HOOK}`;
  expect(resolveWebhookSecret({ webhookSecretEncrypted: row.webhook_secret_encrypted })).toBe("whsec_plaintext_from_1_5_0");
  const cols = (await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'status_page_subscribers'`).map((r) => r.column_name);
  expect(cols).not.toContain("webhook_secret");
  expect(cols).not.toContain("unsubscribe_token");
  expect(await client`SELECT 1 FROM pg_indexes WHERE indexname = 'status_page_subscribers_unsubscribe_token_idx'`).toHaveLength(0);
}, 180_000);

it("reports how many existing rows violate each constraint left NOT VALID", async () => {
  await client.unsafe(`
    ALTER TABLE status_page_subscribers DROP CONSTRAINT status_page_subscribers_mode_check;
    UPDATE status_page_subscribers SET mode = 'bogus' WHERE id = '${HOOK}';
    ALTER TABLE status_page_subscribers ADD CONSTRAINT status_page_subscribers_mode_check CHECK ("mode" IN ('email', 'webhook', 'slack')) NOT VALID;
  `);
  const { stdout } = await migrate(APP_ROOT);
  expect(stdout).toMatch(/\[WARNING\] Constraint status_page_subscribers_mode_check on status_page_subscribers is NOT VALID: 1 existing row\(s\) violate it/);
}, 180_000);
