/** @jest-environment node */
/**
 * Migration and seed contract against a real, disposable PostgreSQL database.
 *
 * A mocked `postgres` client cannot prove that migrations apply to an empty
 * database, that seeds land, or that a second deploy is a no-op. This suite
 * creates its own throwaway database, runs the real `scripts/db-migrate.js`
 * entrypoint against it and drops it afterwards.
 *
 * Run explicitly (kept out of `npm test` because it needs PostgreSQL):
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);

const APP_ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(APP_ROOT, "src/db/migrations");

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests. " +
      "Example: TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db",
  );
}

const databaseName = `supercheck_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
const expectedMigrations = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).length;

let maintenanceClient: ReturnType<typeof postgres>;
let databaseUrl: string;

async function runMigrations(): Promise<void> {
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      // The migration script enforces verify-full TLS unless self-hosted, which
      // a disposable local container does not offer.
      SELF_HOSTED: "true",
      NODE_ENV: "test",
    },
    timeout: 90_000,
  });
}

beforeAll(async () => {
  maintenanceClient = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenanceClient.unsafe(`CREATE DATABASE "${databaseName}"`);

  const target = new URL(maintenanceUrl);
  target.pathname = `/${databaseName}`;
  databaseUrl = target.toString();
});

afterAll(async () => {
  if (!maintenanceClient) return;
  await maintenanceClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenanceClient.end({ timeout: 5 });
});

describe("database migrations and seeds", () => {
  it(
    "applies every migration to an empty database and records it",
    async () => {
      await runMigrations();

      const db = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const [{ count }] = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM "__drizzle_migrations"
        `;
        expect(count).toBe(expectedMigrations);

        const tables = await db<{ table_name: string }[]>`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
        `;
        const names = new Set(tables.map((row) => row.table_name));
        for (const required of [
          "organization",
          "monitor_results",
          "execution_usage_receipts",
          "usage_events",
          "sre_investigation_runs",
          "status_pages",
        ]) {
          expect(names).toContain(required);
        }
      } finally {
        await db.end({ timeout: 5 });
      }
    },
    120_000,
  );

  it(
    "adds the invitation.created_at column Better Auth 1.7 requires, defaulted so older writers keep working",
    async () => {
      const db = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const [column] = await db<
          { data_type: string; is_nullable: string; column_default: string | null }[]
        >`
          SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'invitation'
            AND column_name = 'created_at'
        `;
        expect(column).toBeDefined();
        expect(column.data_type).toBe("timestamp without time zone");
        expect(column.is_nullable).toBe("NO");
        expect(column.column_default).toMatch(/now\(\)/i);

        // The invite route inserts without created_at; the default must fill it.
        const [{ id: userId }] = await db<{ id: string }[]>`
          INSERT INTO "user" (id, name, email)
          VALUES (${randomUUID()}, 'Invite Inviter', ${`inviter-${randomUUID()}@example.com`})
          RETURNING id
        `;
        const [{ id: organizationId }] = await db<{ id: string }[]>`
          INSERT INTO organization (id, name, slug, created_at)
          VALUES (${randomUUID()}, 'Invite Org', ${`invite-${randomUUID()}`}, now()) RETURNING id
        `;
        const [invitation] = await db<{ recent: boolean }[]>`
          INSERT INTO invitation (id, organization_id, email, role, expires_at, inviter_id)
          VALUES (${randomUUID()}, ${organizationId}, 'invitee@example.com', 'project_viewer',
                  now() + interval '1 day', ${userId})
          RETURNING created_at > now() - interval '1 minute' AS recent
        `;
        expect(invitation.recent).toBe(true);
      } finally {
        await db.end({ timeout: 5 });
      }
    },
    120_000,
  );

  it(
    "does not leak SET LOCAL timeouts out of migration 0035 (the migrator uses one transaction)",
    async () => {
      const sqlText = readFileSync(
        path.join(MIGRATIONS_DIR, "0035_invitation_created_at.sql"),
        "utf8",
      );
      const db = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const [before] = await db<{ lock: string; statement: string }[]>`
          SELECT current_setting('lock_timeout') AS lock,
                 current_setting('statement_timeout') AS statement
        `;
        const after = await db.begin(async (tx) => {
          await tx.unsafe(sqlText);
          const [row] = await tx<{ lock: string; statement: string }[]>`
            SELECT current_setting('lock_timeout') AS lock,
                   current_setting('statement_timeout') AS statement
          `;
          return row;
        });
        expect(after).toEqual(before);
      } finally {
        await db.end({ timeout: 5 });
      }
    },
    120_000,
  );

  it(
    "seeds the plans the application bills against",
    async () => {
      const db = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const plans = await db<{ plan: string }[]>`
          SELECT plan FROM plan_limits ORDER BY plan
        `;
        const seeded = plans.map((row) => row.plan);
        expect(seeded).toEqual(expect.arrayContaining(["plus", "pro"]));

        const [{ count: pricingCount }] = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM overage_pricing
        `;
        expect(pricingCount).toBeGreaterThan(0);
      } finally {
        await db.end({ timeout: 5 });
      }
    },
    120_000,
  );

  it(
    "is idempotent when the same deploy runs again",
    async () => {
      const db = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        const before = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM plan_limits
        `;

        await runMigrations();

        const [{ count: appliedAfter }] = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM "__drizzle_migrations"
        `;
        const after = await db<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM plan_limits
        `;

        expect(appliedAfter).toBe(expectedMigrations);
        expect(after[0].count).toBe(before[0].count);
      } finally {
        await db.end({ timeout: 5 });
      }
    },
    120_000,
  );
});
