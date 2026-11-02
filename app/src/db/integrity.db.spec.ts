/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves migration 0050: relationships, uniqueness
// and required tenant columns are enforced by the database, and that every constraint that existing data
// could violate is guarded so the migration never fails on unknown data.
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
const freshName = `integrity_fresh_${suffix}`;
const dirtyName = `integrity_dirty_${suffix}`;
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

const id = () => randomUUID();
type Sql = ReturnType<typeof postgres>;
async function insert(db: Sql, table: string, row: Record<string, unknown>) {
  await db`INSERT INTO ${db(table)} ${db(row as Record<string, string>)}`;
}
/** Resolves with the violated constraint (or unique index) name of a rejected statement. */
async function violated(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const { constraint_name: name } = error as { constraint_name?: string };
    if (name) return name;
    throw error;
  }
  throw new Error("statement was accepted but should have been rejected");
}
async function seedTenant(db: Sql) {
  const org = id();
  const project = id();
  await insert(db, "organization", { id: org, name: "org", created_at: new Date() });
  await insert(db, "projects", { id: project, organization_id: org, name: "p" });
  return { org, project };
}

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${freshName}"`);
  await maintenance.unsafe(`CREATE DATABASE "${dirtyName}"`);
  await migrate(freshName, APP_ROOT);
  fresh = postgres(urlFor(freshName), { max: 1, onnotice: () => {} });
  dirty = postgres(urlFor(dirtyName), { max: 1, onnotice: () => {} });
  workDir = mkdtempSync(path.join(os.tmpdir(), "integrity-"));
}, 180_000);

afterAll(async () => {
  await fresh?.end({ timeout: 5 });
  await dirty?.end({ timeout: 5 });
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${freshName}" WITH (FORCE)`);
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${dirtyName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const FOREIGN_KEYS: Array<[string, string, string]> = [
  ["k6_performance_runs", "test_id", "tests"],
  ["incidents", "sre_incident_id", "sre_incidents"],
  ["sre_alert_events", "triage_investigation_run_id", "sre_investigation_runs"],
  ["sre_incidents", "triage_investigation_run_id", "sre_investigation_runs"],
  ["sre_evidence_items", "investigation_run_id", "sre_investigation_runs"],
  ["sre_investigation_recommendations", "superseded_by_id", "sre_investigation_recommendations"],
  ["sre_context_recollections", "promoted_to_playbook_id", "sre_context_playbooks"],
  ["sre_service_dependencies", "evidence_item_id", "sre_evidence_items"],
  ["sre_services", "runbook_id", "sre_runbooks"],
  ["sre_services", "merged_into_service_id", "sre_services"],
];

describe("fresh database (everything validates)", () => {
  it("has no constraint left NOT VALID", async () => {
    const rows = await fresh`SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace = 'public'::regnamespace`;
    expect(rows).toEqual([]);
  });

  it.each(FOREIGN_KEYS)("%s.%s references %s with ON DELETE SET NULL", async (table, column, parent) => {
    const rows = await fresh`
      SELECT c.confdeltype, c.convalidated, c.confrelid::regclass::text AS parent
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conrelid = ${table}::regclass AND a.attname = ${column}`;
    expect(rows).toEqual([{ confdeltype: "n", convalidated: true, parent }]);
  });

  it("rejects a dangling self reference and nulls it when the parent is deleted", async () => {
    const { org, project } = await seedTenant(fresh);
    const parent = id();
    const child = id();
    await insert(fresh, "sre_services", { id: parent, organization_id: org, project_id: project, name: "a" });
    expect(
      await violated(insert(fresh, "sre_services", { id: id(), organization_id: org, project_id: project, name: "x", merged_into_service_id: id() })),
    ).toBe("sre_services_merged_into_service_id_fkey");
    expect(
      await violated(insert(fresh, "sre_services", { id: id(), organization_id: org, project_id: project, name: "y", runbook_id: id() })),
    ).toBe("sre_services_runbook_id_fkey");
    await insert(fresh, "sre_services", { id: child, organization_id: org, project_id: project, name: "b", status: "merged", merged_into_service_id: parent });
    await fresh`DELETE FROM sre_services WHERE id = ${parent}`;
    expect((await fresh`SELECT merged_into_service_id FROM sre_services WHERE id = ${child}`)[0].merged_into_service_id).toBeNull();
  });

  it("rejects a k6 run linked to a test that does not exist", async () => {
    const { org, project } = await seedTenant(fresh);
    const run = id();
    await insert(fresh, "runs", { id: run, project_id: project });
    const row = { id: id(), run_id: run, organization_id: org, project_id: project, status: "passed" };
    expect(await violated(insert(fresh, "k6_performance_runs", { ...row, test_id: id() }))).toBe("k6_performance_runs_test_id_fkey");
    const test = id();
    await insert(fresh, "tests", { id: test, title: "t", organization_id: org, project_id: project });
    await insert(fresh, "k6_performance_runs", { ...row, id: id(), test_id: test });
    await fresh`DELETE FROM tests WHERE id = ${test}`;
    expect((await fresh`SELECT test_id FROM k6_performance_runs WHERE run_id = ${run}`)[0].test_id).toBeNull();
  });

  it("indexes every new foreign key column", async () => {
    const rows = await fresh`
      SELECT c.conrelid::regclass::text AS tbl, a.attname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.conname = ANY(${FOREIGN_KEYS.map(([t, c]) => `${t}_${c}_fkey`)})
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`;
    expect(rows).toEqual([]);
  });

  it("requires tenant columns", async () => {
    const { org, project } = await seedTenant(fresh);
    const tenant = { organization_id: org, project_id: project };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["runs", {}, "runs_project_id_required_check"],
      ["tests", { title: "t", project_id: project }, "tests_organization_id_required_check"],
      ["tests", { title: "t", organization_id: org }, "tests_project_id_required_check"],
      ["jobs", { name: "j", project_id: project }, "jobs_organization_id_required_check"],
      ["jobs", { name: "j", organization_id: org }, "jobs_project_id_required_check"],
      ["monitors", { name: "m", type: "http_request", target: "https://example.test", project_id: project }, "monitors_organization_id_required_check"],
      ["monitors", { name: "m", type: "http_request", target: "https://example.test", organization_id: org }, "monitors_project_id_required_check"],
      ["notification_providers", { name: "n", type: "email", config: "{}", project_id: project }, "notification_providers_organization_id_required_check"],
      ["notification_providers", { name: "n", type: "email", config: "{}", organization_id: org }, "notification_providers_project_id_required_check"],
      ["tags", { name: "t", project_id: project }, "tags_organization_id_required_check"],
      ["alerts", {}, "alerts_organization_id_required_check"],
    ];
    for (const [table, row, constraint] of cases) {
      expect(await violated(insert(fresh, table, { id: id(), ...row }))).toBe(constraint);
    }
    // The same rows are accepted once the tenant is set.
    await insert(fresh, "tests", { id: id(), title: "t", ...tenant });
    await insert(fresh, "jobs", { id: id(), name: "j", ...tenant });
    await insert(fresh, "runs", { id: id(), project_id: project });
  });

  it("requires an alert history row to name a monitor or a job", async () => {
    const row = { id: id(), message: "m", type: "monitor_failure", target: "t", target_type: "monitor", provider: "email" };
    expect(await violated(insert(fresh, "alert_history", row))).toBe("alert_history_target_required_check");
  });

  it("requires the usage counters", async () => {
    const { org } = await seedTenant(fresh);
    for (const column of ["playwright_minutes_used", "k6_vu_minutes_used", "ai_credits_used"]) {
      expect(await violated(fresh.unsafe(`UPDATE organization SET ${column} = NULL WHERE id = '${org}'`))).toBe(`organization_${column}_required_check`);
    }
  });

  it("keeps customer and subscription references unique but lets many organizations have none", async () => {
    const a = id();
    const b = id();
    await insert(fresh, "organization", { id: a, name: "a", created_at: new Date(), polar_customer_id: "cust-1", subscription_id: "sub-1" });
    await insert(fresh, "organization", { id: id(), name: "none-1", created_at: new Date() });
    await insert(fresh, "organization", { id: id(), name: "none-2", created_at: new Date() });
    expect(await violated(insert(fresh, "organization", { id: b, name: "b", created_at: new Date(), polar_customer_id: "cust-1" }))).toBe("organization_polar_customer_id_idx");
    expect(await violated(insert(fresh, "organization", { id: b, name: "b", created_at: new Date(), subscription_id: "sub-1" }))).toBe("organization_subscription_id_idx");
  });

  it("allows one pending invitation per organization and address, ignoring case", async () => {
    const { org } = await seedTenant(fresh);
    const other = await seedTenant(fresh);
    const user = id();
    await insert(fresh, "user", { id: user, name: "u", email: `${user}@example.test` });
    const row = { organization_id: org, inviter_id: user, expires_at: new Date(Date.now() + 1e9) };
    await insert(fresh, "invitation", { id: id(), email: "Dev@Example.test", status: "pending", ...row });
    expect(await violated(insert(fresh, "invitation", { id: id(), email: "dev@example.test", status: "pending", ...row }))).toBe("invitation_pending_org_email_unique_idx");
    await insert(fresh, "invitation", { id: id(), email: "dev@example.test", status: "expired", ...row });
    await insert(fresh, "invitation", { id: id(), email: "dev@example.test", status: "accepted", ...row });
    await insert(fresh, "invitation", { id: id(), email: "dev@example.test", status: "pending", ...row, organization_id: other.org });
  });

  it("rejects duplicate service owners and template components, and drops the indexes they cover", async () => {
    const { org, project } = await seedTenant(fresh);
    const service = id();
    await insert(fresh, "sre_services", { id: service, organization_id: org, project_id: project, name: "s" });
    const owner = { service_id: service, owner_type: "user", owner_ref: "u1", role: "primary" };
    await insert(fresh, "sre_service_owners", { id: id(), ...owner });
    expect(await violated(insert(fresh, "sre_service_owners", { id: id(), ...owner }))).toBe("sre_service_owners_unique_idx");
    await insert(fresh, "sre_service_owners", { id: id(), ...owner, role: "secondary" });

    const page = id();
    const template = id();
    const component = id();
    await insert(fresh, "status_pages", { id: page, organization_id: org, name: "sp", subdomain: id().replace(/-/g, "") });
    await insert(fresh, "incident_templates", { id: template, status_page_id: page, name: "n", title: "t", body: "b" });
    await insert(fresh, "status_page_components", { id: component, status_page_id: page, name: "c" });
    await insert(fresh, "incident_template_components", { id: id(), template_id: template, component_id: component });
    expect(await violated(insert(fresh, "incident_template_components", { id: id(), template_id: template, component_id: component }))).toBe("incident_template_components_unique_idx");

    const dropped = await fresh`SELECT indexname FROM pg_indexes WHERE indexname IN ('sre_service_owners_service_id_idx', 'incident_template_components_template_id_idx')`;
    expect(dropped).toEqual([]);
  });

  it("requires lower-case status page hostnames", async () => {
    const { org } = await seedTenant(fresh);
    const base = { organization_id: org, name: "sp" };
    expect(await violated(insert(fresh, "status_pages", { id: id(), ...base, subdomain: "MixedCase" }))).toBe("status_pages_subdomain_lowercase_check");
    expect(await violated(insert(fresh, "status_pages", { id: id(), ...base, subdomain: id().replace(/-/g, ""), custom_domain: "Status.Example.com" }))).toBe("status_pages_custom_domain_lowercase_check");
    await insert(fresh, "status_pages", { id: id(), ...base, subdomain: id().replace(/-/g, ""), custom_domain: "status.example.com" });
  });
});

describe("existing data that violates a constraint", () => {
  it("never fails the migration: clears dangling ids, keeps violated constraints NOT VALID and enforces new writes", async () => {
    // A database exactly as it is before this migration.
    const before = path.join(workDir, "before");
    mkdirSync(path.join(before, "src/db"), { recursive: true });
    cpSync(MIGRATIONS_DIR, path.join(before, "src/db/migrations"), { recursive: true });
    const migrationFiles = readdirSync(path.join(before, "src/db/migrations")).filter((f) => f.endsWith(".sql"));
    const target = migrationFiles.find((f) => f.startsWith("0050_"));
    expect(target).toBeDefined();
    rmSync(path.join(before, "src/db/migrations", target as string));
    await migrate(dirtyName, before);

    // Seed rows the new constraints reject.
    const org = id();
    const project = id();
    const user = id();
    const [dupA, dupB] = [id(), id()];
    await insert(dirty, "organization", { id: org, name: "o", created_at: new Date(), subscription_id: "sub-9" });
    await dirty`UPDATE organization SET playwright_minutes_used = NULL, k6_vu_minutes_used = NULL, ai_credits_used = NULL WHERE id = ${org}`;
    await insert(dirty, "organization", { id: dupA, name: "a", created_at: new Date(), polar_customer_id: "dup" });
    await insert(dirty, "organization", { id: dupB, name: "b", created_at: new Date(), polar_customer_id: "dup" });
    await insert(dirty, "projects", { id: project, organization_id: org, name: "p" });
    await insert(dirty, "user", { id: user, name: "u", email: `${user}@example.test` });
    // The old invite route allowed re-inviting after expiry, leaving the stale row "pending".
    const invite = { organization_id: org, inviter_id: user, status: "pending" };
    const stale = id();
    await insert(dirty, "invitation", { id: stale, email: "Dev@example.test", ...invite, expires_at: new Date(Date.now() - 1e9) });
    await insert(dirty, "invitation", { id: id(), email: "dev@example.test", ...invite, expires_at: new Date(Date.now() + 1e9) });
    const [kept, merged, dangling] = [id(), id(), id()];
    const service = { organization_id: org, project_id: project };
    await insert(dirty, "sre_services", { id: kept, ...service, name: "kept" });
    await insert(dirty, "sre_services", { id: merged, ...service, name: "merged", merged_into_service_id: kept });
    await insert(dirty, "sre_services", { id: dangling, ...service, name: "dangling", merged_into_service_id: id(), runbook_id: id() });
    const owner = { service_id: kept, owner_type: "user", owner_ref: "u1", role: "primary" };
    await insert(dirty, "sre_service_owners", { id: id(), ...owner });
    await insert(dirty, "sre_service_owners", { id: id(), ...owner });
    const [page, template, component] = [id(), id(), id()];
    await insert(dirty, "status_pages", { id: page, organization_id: org, name: "sp", subdomain: "UpperCase" });
    await insert(dirty, "incident_templates", { id: template, status_page_id: page, name: "n", title: "t", body: "b" });
    await insert(dirty, "status_page_components", { id: component, status_page_id: page, name: "c" });
    await insert(dirty, "incident_template_components", { id: id(), template_id: template, component_id: component });
    const orphanTest = id();
    await insert(dirty, "tests", { id: orphanTest, title: "no tenant" });
    // Rows whose tenant is derivable from a parent.
    const [derivedTest, derivedJob, derivedRun] = [id(), id(), id()];
    await insert(dirty, "tests", { id: derivedTest, title: "has project", project_id: project });
    await insert(dirty, "jobs", { id: derivedJob, name: "j", project_id: project });
    await insert(dirty, "runs", { id: derivedRun, job_id: derivedJob });
    await dirty`UPDATE jobs SET organization_id = NULL WHERE id = ${derivedJob}`;
    await insert(dirty, "alert_history", { id: id(), message: "m", type: "monitor_failure", target: "t", target_type: "monitor", provider: "email" });

    // Apply 0050 on top of it.
    cpSync(path.join(MIGRATIONS_DIR, target as string), path.join(before, "src/db/migrations", target as string));
    const { stdout, stderr } = await migrate(dirtyName, before);
    // The post-commit validator reports what it could not validate.
    expect(`${stdout}${stderr}`).toContain("tests_organization_id_required_check left NOT VALID");

    // Dangling ids are cleared, valid ones are kept; no row is deleted.
    const services = await dirty`SELECT id, merged_into_service_id, runbook_id FROM sre_services`;
    const byId = new Map(services.map((row) => [row.id, row]));
    expect(byId.get(merged)?.merged_into_service_id).toBe(kept);
    expect(byId.get(dangling)).toMatchObject({ merged_into_service_id: null, runbook_id: null });
    expect(services).toHaveLength(3);
    expect(await dirty`SELECT 1 FROM tests WHERE id = ${orphanTest}`).toHaveLength(1);

    // Tenant columns are filled from the parent; a row with no parent stays NULL.
    expect((await dirty`SELECT organization_id FROM tests WHERE id = ${derivedTest}`)[0].organization_id).toBe(org);
    expect((await dirty`SELECT organization_id FROM jobs WHERE id = ${derivedJob}`)[0].organization_id).toBe(org);
    expect((await dirty`SELECT project_id FROM runs WHERE id = ${derivedRun}`)[0].project_id).toBe(project);
    expect((await dirty`SELECT organization_id FROM tests WHERE id = ${orphanTest}`)[0].organization_id).toBeNull();
    // The superseded stale invitation is cancelled, the live one stays pending.
    expect((await dirty`SELECT status FROM invitation WHERE id = ${stale}`)[0].status).toBe("cancelled");

    // Counters are 0 and required.
    expect(await dirty`SELECT 1 FROM organization WHERE id = ${org} AND playwright_minutes_used = 0 AND k6_vu_minutes_used = 0 AND ai_credits_used = 0`).toHaveLength(1);

    const validity = Object.fromEntries(
      (await dirty`SELECT conname, convalidated FROM pg_constraint WHERE connamespace = 'public'::regnamespace`).map((r) => [r.conname, r.convalidated]),
    );
    // Left NOT VALID because of the seeded rows.
    for (const name of [
      "tests_organization_id_required_check",
      "tests_project_id_required_check",
      "status_pages_subdomain_lowercase_check",
      "alert_history_target_required_check",
    ]) {
      expect(validity[name]).toBe(false);
    }
    // Validated because nothing violates them.
    for (const name of [
      "jobs_organization_id_required_check",
      "runs_project_id_required_check",
      "status_pages_custom_domain_lowercase_check",
      "sre_services_merged_into_service_id_fkey",
      "sre_services_runbook_id_fkey",
      "organization_ai_credits_used_required_check",
    ]) {
      expect(validity[name]).toBe(true);
    }

    // Unique indexes: created where clean, skipped (existing index kept) where duplicates exist.
    const indexes = await dirty`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const def = (name: string) => indexes.find((row) => row.indexname === name)?.indexdef;
    expect(def("organization_subscription_id_idx")).toContain("UNIQUE");
    expect(def("organization_polar_customer_id_idx")).toBeDefined();
    expect(def("organization_polar_customer_id_idx")).not.toContain("UNIQUE");
    expect(def("invitation_pending_org_email_unique_idx")).toContain("UNIQUE");
    expect(def("sre_service_owners_unique_idx")).toBeUndefined();
    expect(def("sre_service_owners_service_id_idx")).toBeDefined();
    expect(def("incident_template_components_unique_idx")).toContain("UNIQUE");
    expect(def("incident_template_components_template_id_idx")).toBeUndefined();

    // A NOT VALID constraint still rejects new bad writes.
    expect(await violated(insert(dirty, "tests", { id: id(), title: "still no tenant" }))).toBe("tests_organization_id_required_check");
    expect(await violated(insert(dirty, "status_pages", { id: id(), organization_id: org, name: "x", subdomain: "AlsoUpper" }))).toBe("status_pages_subdomain_lowercase_check");
    expect(await violated(insert(dirty, "sre_services", { id: id(), ...service, name: "new", runbook_id: id() }))).toBe("sre_services_runbook_id_fkey");

    // Re-running the migrator is a no-op.
    await migrate(dirtyName, before);
  }, 180_000);
});
