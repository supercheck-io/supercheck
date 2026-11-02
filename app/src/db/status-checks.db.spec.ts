/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves migration 0051: status, type and other
// enum-like columns only accept the values the application writes, and that data which already violates a
// constraint never fails the migration (the constraint stays NOT VALID and still rejects new bad writes).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(APP_ROOT, "src/db/migrations");
const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) throw new Error("TEST_DATABASE_URL is required for database integration tests.");

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const freshName = `status_fresh_${suffix}`;
const dirtyName = `status_dirty_${suffix}`;
let maintenance: ReturnType<typeof postgres>;
let fresh: ReturnType<typeof postgres>;
let dirty: ReturnType<typeof postgres>;
let workDir: string;

const urlFor = (name: string) => {
  const target = new URL(maintenanceUrl);
  target.pathname = `/${name}`;
  return target.toString();
};
const migrate = (name: string, cwd: string) =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd,
    env: { ...process.env, DATABASE_URL: urlFor(name), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });

/** Resolves with the SQLSTATE code of a rejected statement. */
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return "accepted";
}

async function seedTenant(db: ReturnType<typeof postgres>) {
  const org = randomUUID();
  const project = randomUUID();
  await db`INSERT INTO organization (id, name, created_at) VALUES (${org}, 'o', now())`;
  await db`INSERT INTO projects (id, organization_id, name) VALUES (${project}, ${org}, 'p')`;
  return { org, project };
}

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${freshName}"`);
  await maintenance.unsafe(`CREATE DATABASE "${dirtyName}"`);
  await migrate(freshName, APP_ROOT);
  fresh = postgres(urlFor(freshName), { max: 1, onnotice: () => {} });
  dirty = postgres(urlFor(dirtyName), { max: 1, onnotice: () => {} });
  workDir = mkdtempSync(path.join(os.tmpdir(), "status-checks-"));
}, 180_000);

afterAll(async () => {
  await fresh?.end({ timeout: 5 });
  await dirty?.end({ timeout: 5 });
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${freshName}" WITH (FORCE)`);
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${dirtyName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

// [table, column, allowed values, nullable] (NULL needs no test here: a CHECK never rejects NULL, NOT NULL does)
const CHECKED: Array<[string, string, string[], boolean?]> = [
  ["jobs", "job_type", ["playwright", "k6"]],
  ["jobs", "status", ["pending", "running", "passed", "failed", "error"]],
  ["runs", "status", ["running", "passed", "failed", "error", "blocked", "queued"]],
  ["runs", "trigger", ["manual", "remote", "schedule"]],
  ["k6_performance_runs", "status", ["running", "passed", "failed", "error", "blocked", "queued"]],
  ["monitor_aggregates", "period_type", ["hourly", "daily"]],
  ["monitors", "type", ["http_request", "website", "ping_host", "port_check", "synthetic_test"]],
  ["monitors", "status", ["up", "down", "paused", "pending", "maintenance", "error"]],
  ["monitor_results", "status", ["up", "down", "error", "timeout"]],
  ["notification_providers", "type", ["email", "slack", "webhook", "telegram", "discord", "teams"]],
  ["alert_history", "type", ["monitor_failure", "monitor_recovery", "job_failed", "job_success", "job_timeout", "ssl_expiring"]],
  ["alert_history", "status", ["sent", "failed", "pending"]],
  ["organization", "subscription_plan", ["plus", "pro", "unlimited"], true],
  ["organization", "subscription_status", ["active", "canceled", "past_due", "none"], true],
  ["projects", "status", ["active", "archived", "deleted"]],
  ["project_variables", "type", ["variable", "secret", "file"]],
  ["plan_limits", "plan", ["plus", "pro", "unlimited"]],
  ["overage_pricing", "plan", ["plus", "pro"]],
  ["reports", "entity_type", ["test", "job", "monitor", "k6_test", "k6_job"]],
  ["tests", "type", ["browser", "api", "database", "custom", "performance"]],
  ["tests", "priority", ["low", "medium", "high"]],
  ["usage_events", "event_type", ["playwright_execution", "k6_execution", "monitor_execution", "ai_usage", "sre_investigation"]],
  ["usage_notifications", "notification_type", ["usage_50_percent", "usage_80_percent", "usage_90_percent", "usage_100_percent", "spending_limit_warning", "spending_limit_reached", "billing_period_reset"]],
  ["usage_notifications", "resource_type", ["playwright", "k6", "ai", "sre", "combined", "spending"]],
  ["usage_notifications", "delivery_status", ["pending", "sent", "failed"]],
  ["status_pages", "status", ["draft", "published", "archived"]],
  ["status_page_components", "status", ["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"]],
  ["incidents", "status", ["investigating", "identified", "monitoring", "resolved", "scheduled"]],
  ["incidents", "impact", ["none", "minor", "major", "critical"]],
  ["incident_updates", "status", ["investigating", "identified", "monitoring", "resolved", "scheduled"]],
  ["status_page_subscribers", "mode", ["email", "webhook", "slack"]],
  ["sre_services", "status", ["active", "deprecated", "merged"]],
  ["sre_services", "tier", ["1", "2", "3", "4"]],
  ["sre_service_owners", "owner_type", ["team", "user", "slack"]],
  ["sre_service_owners", "role", ["primary", "on-call", "secondary", "reviewer"]],
  ["sre_service_resources", "resource_type", ["monitor", "job", "test", "status_page_component", "k6_run"]],
  ["sre_service_resources", "relationship", ["monitors", "owned", "depends_on"]],
  ["sre_service_dependencies", "status", ["active", "stale", "rejected"]],
  ["sre_alert_events", "severity", ["sev1", "sev2", "sev3", "sev4"]],
  ["sre_alert_events", "status", ["firing", "resolved", "silenced", "deduplicated"]],
  ["sre_incidents", "severity", ["sev1", "sev2", "sev3", "sev4"]],
  ["sre_incidents", "status", ["triggered", "investigating", "identified", "recommendations_ready", "user_applying_fix", "verifying", "resolved"]],
  ["sre_incident_alerts", "role", ["trigger", "related", "red_herring"]],
  ["sre_investigation_runs", "status", ["running", "completed", "failed", "aborted", "timed_out"]],
  ["sre_investigation_tool_calls", "status", ["success", "error", "timeout", "aborted"]],
  ["private_agents", "status", ["pending", "connected", "disconnected", "unhealthy", "disabled"]],
  ["private_agents", "agent_mode", ["connector_proxy", "execution_worker", "hybrid"]],
  ["private_agent_jobs", "status", ["queued", "leased", "running", "completed", "failed", "cancelled", "timed_out"]],
  ["private_agent_jobs", "job_class", ["sre_connector_query", "http_monitor_check", "playwright_run", "k6_run", "network_check"]],
  ["external_connectors", "status", ["configured", "valid", "unreachable", "missing_credentials", "disabled"]],
  ["external_connectors", "risk_level", ["low", "medium", "high", "critical"]],
  ["invitation", "status", ["pending", "accepted", "rejected", "canceled", "cancelled", "expired"]],
];

describe("status value checks on a fresh database", () => {
  it("validates every constraint", async () => {
    const rows = await fresh`SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace = 'public'::regnamespace`;
    expect(rows).toEqual([]);
  });

  it.each(CHECKED)("%s.%s accepts exactly its allowed values", async (table, column, allowed) => {
    const [constraint] = await fresh`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = ${`public.${table}`}::regclass AND conname = ${`${table}_${column}_check`}`;
    expect(constraint).toBeDefined();
    // Re-create the stored definition on a scratch table to exercise the real expression.
    const scratch = `scratch_${table}_${column}`.slice(0, 60);
    // fresh holds a single connection, so the session-level temp table stays visible.
    await fresh.unsafe(`CREATE TEMP TABLE "${scratch}" ("${column}" text, CONSTRAINT c ${constraint.definition})`);
    try {
      for (const value of allowed) {
        expect(await codeOf(fresh.unsafe(`INSERT INTO "${scratch}" VALUES ($1)`, [value]))).toBe("accepted");
      }
      expect(await codeOf(fresh.unsafe(`INSERT INTO "${scratch}" VALUES ($1)`, ["not_a_value"]))).toBe("23514");
    } finally {
      await fresh.unsafe(`DROP TABLE "${scratch}"`);
    }
  });

  it("rejects an unknown value on the real tables", async () => {
    expect(await codeOf(fresh`UPDATE plan_limits SET plan = 'bogus' WHERE plan = 'plus'`)).toBe("23514");
    const tenant = await seedTenant(fresh);
    const test = (type: string) => fresh`INSERT INTO tests (id, title, type, organization_id, project_id)
      VALUES (${randomUUID()}, 't', ${type}, ${tenant.org}, ${tenant.project})`;
    expect(await codeOf(test("bogus"))).toBe("23514");
    expect(await codeOf(test("api"))).toBe("accepted");
    // Better Auth writes the US spelling and the application the UK one; both stay valid.
    const org = tenant.org;
    const user = randomUUID();
    await fresh`INSERT INTO "user" (id, name, email) VALUES (${user}, 'u', ${`${user}@example.test`})`;
    for (const status of ["canceled", "cancelled", "accepted", "rejected", "expired", "pending"]) {
      expect(
        await codeOf(fresh`INSERT INTO invitation (id, organization_id, email, inviter_id, status, expires_at)
          VALUES (${randomUUID()}, ${org}, ${`${status}@example.test`}, ${user}, ${status}, now())`),
      ).toBe("accepted");
    }
    expect(await codeOf(fresh`UPDATE organization SET subscription_status = 'trialing' WHERE id = ${org}`)).toBe("23514");
    expect(await codeOf(fresh`UPDATE organization SET subscription_plan = NULL, subscription_status = NULL WHERE id = ${org}`)).toBe("accepted");
  });
});

describe("existing data that violates a constraint", () => {
  it("never fails the migration: the constraint stays NOT VALID, a warning is logged and new bad writes are rejected", async () => {
    const before = path.join(workDir, "before");
    mkdirSync(path.join(before, "src/db"), { recursive: true });
    cpSync(MIGRATIONS_DIR, path.join(before, "src/db/migrations"), { recursive: true });
    const target = readdirSync(path.join(before, "src/db/migrations")).find((f) => f.startsWith("0051_") && f.endsWith(".sql"));
    expect(target).toBeDefined();
    rmSync(path.join(before, "src/db/migrations", target as string));
    await migrate(dirtyName, before);

    const tenant = await seedTenant(dirty);
    const test = (type: string) => dirty`INSERT INTO tests (id, title, type, organization_id, project_id)
      VALUES (${randomUUID()}, 'x', ${type}, ${tenant.org}, ${tenant.project})`;
    await test("legacy_type");

    cpSync(path.join(MIGRATIONS_DIR, target as string), path.join(before, "src/db/migrations", target as string));
    const { stdout, stderr } = await migrate(dirtyName, before);
    expect(`${stdout}${stderr}`).toContain("tests_type_check left NOT VALID");

    const state = await dirty`SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('tests_type_check', 'tests_priority_check')`;
    expect(Object.fromEntries(state.map((r) => [r.conname, r.convalidated]))).toEqual({
      tests_type_check: false,
      tests_priority_check: true,
    });
    // The legacy row survives, but a new bad write is rejected.
    const [{ count }] = await dirty`SELECT count(*)::int AS count FROM tests WHERE type = 'legacy_type'`;
    expect(count).toBe(1);
    expect(await codeOf(test("another_bad_type"))).toBe("23514");
    expect(await codeOf(test("api"))).toBe("accepted");
  }, 180_000);
});
