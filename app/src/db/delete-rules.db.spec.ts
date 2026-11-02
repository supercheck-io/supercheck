/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the ON DELETE rules of migration 0048.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const APP_ROOT = path.resolve(__dirname, "../..");
const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl)
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests.",
  );

const databaseName = `delete_rules_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(maintenanceUrl);
  target.pathname = `/${databaseName}`;
  await promisify(execFile)(
    process.execPath,
    [path.join(APP_ROOT, "scripts/db-migrate.js")],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        SELF_HOSTED: "true",
        NODE_ENV: "test",
      },
      timeout: 90_000,
    },
  );
  sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await maintenance?.unsafe(
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
  );
  await maintenance?.end({ timeout: 5 });
});

const id = () => randomUUID();
const count = async (table: string, where: string) =>
  (
    await sql.unsafe(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`)
  )[0].n as number;

async function seedOrg() {
  const orgId = id();
  await sql`INSERT INTO organization (id, name, created_at) VALUES (${orgId}, 'org', now())`;
  return orgId;
}
async function seedUser() {
  const userId = id();
  await sql`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'u', ${userId + "@example.test"})`;
  return userId;
}

describe("foreign key delete rules", () => {
  it("deleting a user keeps their resources with a NULL creator and removes keys, notifications and sessions", async () => {
    const orgId = await seedOrg();
    const userId = await seedUser();
    const projectId = id();
    await sql`INSERT INTO projects (id, organization_id, name) VALUES (${projectId}, ${orgId}, 'p')`;
    const ids = {
      test: id(),
      job: id(),
      monitor: id(),
      provider: id(),
      tag: id(),
      report: id(),
      variable: id(),
      page: id(),
      incident: id(),
    };
    await sql`INSERT INTO tests (id, organization_id, project_id, title, created_by_user_id) VALUES (${ids.test}, ${orgId}, ${projectId}, 't', ${userId})`;
    await sql`INSERT INTO jobs (id, organization_id, project_id, name, created_by_user_id) VALUES (${ids.job}, ${orgId}, ${projectId}, 'j', ${userId})`;
    await sql`INSERT INTO monitors (id, organization_id, project_id, name, type, target, created_by_user_id) VALUES (${ids.monitor}, ${orgId}, ${projectId}, 'm', 'http_request', 'https://example.test', ${userId})`;
    await sql`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, created_by_user_id) VALUES (${ids.provider}, ${orgId}, ${projectId}, 'n', 'email', '{}', ${userId})`;
    await sql`INSERT INTO tags (id, organization_id, project_id, name, created_by_user_id) VALUES (${ids.tag}, ${orgId}, ${projectId}, 'tag', ${userId})`;
    await sql`INSERT INTO reports (id, organization_id, entity_type, entity_id, report_path, created_by_user_id) VALUES (${ids.report}, ${orgId}, 'test', 'x', 'x/report', ${userId})`;
    await sql`INSERT INTO project_variables (id, project_id, key, value, created_by_user_id) VALUES (${ids.variable}, ${projectId}, 'K', 'v', ${userId})`;
    await sql`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain, created_by_user_id) VALUES (${ids.page}, ${orgId}, ${projectId}, 's', ${"s" + ids.page.slice(0, 8)}, ${userId})`;
    await sql`INSERT INTO incidents (id, status_page_id, name, created_by_user_id) VALUES (${ids.incident}, ${ids.page}, 'i', ${userId})`;
    await sql`INSERT INTO audit_logs (id, user_id, organization_id, action) VALUES (${id()}, ${userId}, ${orgId}, 'a')`;
    await sql`INSERT INTO notifications (id, user_id, content) VALUES (${id()}, ${userId}, '{}')`;
    await sql`INSERT INTO apikey (id, key, user_id, created_at, updated_at) VALUES (${id()}, ${id()}, ${userId}, now(), now())`;
    await sql`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, active_organization_id, active_project_id) VALUES (${id()}, ${id()}, ${userId}, now(), now(), now(), ${orgId}, ${projectId})`;

    await sql`DELETE FROM "user" WHERE id = ${userId}`;

    for (const [table, key] of [
      ["tests", ids.test],
      ["jobs", ids.job],
      ["monitors", ids.monitor],
      ["notification_providers", ids.provider],
      ["tags", ids.tag],
      ["reports", ids.report],
      ["project_variables", ids.variable],
      ["status_pages", ids.page],
      ["incidents", ids.incident],
    ]) {
      expect(
        await count(table, `id = '${key}' AND created_by_user_id IS NULL`),
      ).toBe(1);
    }
    expect(
      await count(
        "audit_logs",
        `organization_id = '${orgId}' AND user_id IS NULL`,
      ),
    ).toBe(1);
    expect(await count("notifications", `user_id = '${userId}'`)).toBe(0);
    expect(await count("apikey", `user_id = '${userId}'`)).toBe(0);
    expect(await count("session", `user_id = '${userId}'`)).toBe(0);
  });

  it("no created_by_user_id foreign key is left on NO ACTION or RESTRICT", async () => {
    const rows = await sql`
      SELECT c.conrelid::regclass::text AS tbl, c.confdeltype FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND a.attname = 'created_by_user_id'`;
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(
      rows
        .filter((r) => r.confdeltype === "a" || r.confdeltype === "r")
        .map((r) => r.tbl),
    ).toEqual([]);
    // Named explicitly: other created_by_user_id keys (e.g. sre_investigation_report_feedback) keep CASCADE.
    const setNullTables = [
      "project_variables", "tests", "jobs", "monitors", "notification_providers", "tags",
      "reports", "incident_templates", "incident_updates", "incidents", "postmortems", "status_pages",
    ];
    expect(rows.filter((r) => setNullTables.includes(r.tbl)).map((r) => r.tbl).sort()).toEqual([...setNullTables].sort());
    expect(rows.filter((r) => setNullTables.includes(r.tbl) && r.confdeltype !== "n").map((r) => r.tbl)).toEqual([]);
  });

  it("clears a session's active organization and project when they are deleted", async () => {
    const orgId = await seedOrg();
    const userId = await seedUser();
    const projectId = id();
    await sql`INSERT INTO projects (id, organization_id, name) VALUES (${projectId}, ${orgId}, 'p')`;
    const sessionId = id();
    await sql`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, active_organization_id, active_project_id) VALUES (${sessionId}, ${id()}, ${userId}, now(), now(), now(), ${orgId}, ${projectId})`;
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
    await sql`DELETE FROM organization WHERE id = ${orgId}`;
    expect(
      await count(
        "session",
        `id = '${sessionId}' AND active_organization_id IS NULL AND active_project_id IS NULL`,
      ),
    ).toBe(1);
  });

  it("deleting an organization with audit rows succeeds and the rows keep the organization id", async () => {
    const orgId = await seedOrg();
    await sql`INSERT INTO audit_logs (id, organization_id, action) VALUES (${id()}, ${orgId}, 'a')`;
    await sql`DELETE FROM organization WHERE id = ${orgId}`;
    expect(await count("audit_logs", `organization_id = '${orgId}'`)).toBe(1);
  });

  it("deleting an organization that owns a private agent with jobs and connectors succeeds; deleting the agent directly does not", async () => {
    const orgId = await seedOrg();
    const projectId = id();
    const agentId = id();
    const connectorId = id();
    await sql`INSERT INTO projects (id, organization_id, name) VALUES (${projectId}, ${orgId}, 'p')`;
    await sql`INSERT INTO private_agents (id, organization_id, name) VALUES (${agentId}, ${orgId}, 'a')`;
    await sql`INSERT INTO external_connectors (id, organization_id, name, type, private_agent_id) VALUES (${connectorId}, ${orgId}, 'c', 'http', ${agentId})`;
    await sql`INSERT INTO private_agent_jobs (id, organization_id, project_id, private_agent_id, connector_id, authorized_by, job_class, job_spec_hash, policy_decision_hash, idempotency_key) VALUES (${id()}, ${orgId}, ${projectId}, ${agentId}, ${connectorId}, 'x', 'network_check', 'h', 'h', ${id()})`;

    await expect(
      sql`DELETE FROM private_agents WHERE id = ${agentId}`,
    ).rejects.toMatchObject({ code: "23503" });

    // The org routes remove projects first (their jobs cascade); the agent and connector are removed by the org cascade in any order.
    await sql`DELETE FROM projects WHERE id = ${projectId}`;
    await sql`DELETE FROM organization WHERE id = ${orgId}`;
    expect(await count("private_agents", `id = '${agentId}'`)).toBe(0);
    expect(await count("external_connectors", `id = '${connectorId}'`)).toBe(0);
  });
});
