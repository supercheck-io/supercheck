/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// 0071 moves only stock Plus/Pro rows, backfills owner caps to 'custom', rejects unknown sources,
// and a rerun changes nothing.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `pricing_caps_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

const migrate = (cwd: string) =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 120_000,
  });
const ORG = { capped: "00000000-0000-0000-0000-0000000000a1", open: "00000000-0000-0000-0000-0000000000a2", enabled: "00000000-0000-0000-0000-0000000000a3" };
const plans = () => client`
  SELECT p.plan, p.ai_credits_included, p.sre_investigation_units_included::float AS sre, p.default_spending_limit_cents,
         o.sre_investigation_unit_price_cents::float AS sre_price
  FROM plan_limits p JOIN overage_pricing o ON o.plan = p.plan ORDER BY p.plan`;

// Today's seed needs the 0071 columns, so a pre-0071 database cannot be built with the current runner.
// Instead migrate fully, put the rows back to their 0027 values, and replay 0071's data statements.
const dataStatements = readFileSync(path.join(APP_ROOT, "src/db/migrations/0071_pricing_29_99_default_caps.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => !statement.startsWith("ALTER TABLE"));
const replay = async () => {
  for (const statement of dataStatements) await client.unsafe(statement);
};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await migrate(APP_ROOT);
  // Stock Plus at its 0027 values; Pro is a custom contract (1,234 credits) that must not move.
  await client.unsafe(`
    UPDATE plan_limits SET ai_credits_included = 1000, sre_investigation_units_included = 200, default_spending_limit_cents = NULL WHERE plan = 'plus';
    UPDATE plan_limits SET ai_credits_included = 1234, sre_investigation_units_included = 1000, default_spending_limit_cents = NULL WHERE plan = 'pro';
    UPDATE overage_pricing SET sre_investigation_unit_price_cents = 10;
    INSERT INTO organization (id, name, created_at) VALUES
      ('${ORG.capped}', 'a', now()), ('${ORG.open}', 'b', now()), ('${ORG.enabled}', 'c', now());
    INSERT INTO billing_settings (id, organization_id, monthly_spending_limit_cents, enable_spending_limit) VALUES
      (gen_random_uuid(), '${ORG.capped}', 5000, false), (gen_random_uuid(), '${ORG.open}', NULL, false),
      (gen_random_uuid(), '${ORG.enabled}', 9000, true);
  `);
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("moves stock Plus to the new allowances, leaves a custom Pro contract's prices alone, and caps both", async () => {
  await replay();
  expect(await plans()).toEqual([
    { plan: "plus", ai_credits_included: 500, sre: 100, default_spending_limit_cents: 7000, sre_price: 25 },
    { plan: "pro", ai_credits_included: 1234, sre: 1000, default_spending_limit_cents: 30000, sre_price: 10 },
  ]);
}, 180_000);

it("keeps owner caps and puts everyone else on the plan default", async () => {
  const rows = await client`SELECT organization_id, spending_limit_source FROM billing_settings ORDER BY organization_id`;
  expect(rows.map((row) => row.spending_limit_source)).toEqual(["custom", "plan_default", "custom"]);
  const insert = client`INSERT INTO billing_settings (id, organization_id, spending_limit_source) VALUES (${randomUUID()}, ${ORG.open}, 'other')
    ON CONFLICT (organization_id) DO UPDATE SET spending_limit_source = EXCLUDED.spending_limit_source`;
  await expect(insert).rejects.toMatchObject({ code: "23514" });
});

it("a rerun is a no-op", async () => {
  const before = await plans();
  await replay();
  expect(await plans()).toEqual(before);
});
