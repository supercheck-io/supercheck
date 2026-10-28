/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/ai/ai-provider", () => ({ getActualModelName: () => "test-model" }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { persistNativeEvidence } from "./evidence-brief-orchestrator";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `native_evidence_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const org = randomUUID();
const project = randomUUID();
const monitorId = randomUUID();
const incidentId = randomUUID();
const alertId = randomUUID();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  client = postgres(url.toString(), { max: 2, onnotice: () => {} });
  mockDatabase = drizzle(client);
  await client.unsafe("SET session_replication_role = replica");
  const now = new Date().toISOString();
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, 'o', ${org}, ${now})`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project})`;
  await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target) VALUES (${monitorId}, ${org}, ${project}, 'API', 'http_request', 'https://example.com')`;
  await client`INSERT INTO sre_incidents (incident_number, id, organization_id, project_id, title, severity, status, created_at) VALUES (1, ${incidentId}, ${org}, ${project}, 'Monitor down', 'sev2', 'triggered', ${now})`;
  await client`INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, dedup_key, severity, status, source_type, source_id, title, fired_at) VALUES (${alertId}, ${org}, ${project}, 'fp', 'dk', 'sev2', 'firing', 'monitor', ${monitorId}, 'API down', ${now})`;
  await client`INSERT INTO sre_incident_alerts (id, incident_id, alert_event_id) VALUES (${randomUUID()}, ${incidentId}, ${alertId})`;
  for (let i = 0; i < 3; i += 1) {
    await client`INSERT INTO monitor_results (id, monitor_id, location, status, is_up, checked_at, response_time_ms, details) VALUES (${randomUUID()}, ${monitorId}, 'us-east', 'down', false, ${new Date(Date.now() - i * 60_000).toISOString()}, 100, '{"error":"ECONNREFUSED"}'::jsonb)`;
  }
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("persists native evidence for a monitor-alert incident and is idempotent", async () => {
  const scope = { organizationId: org, projectId: project, incidentId, userId: null };
  const first = await persistNativeEvidence(scope);
  expect(first.createdCount).toBeGreaterThan(0);
  expect(first.rows.every((row) => row.sourceType === "native" && row.investigationRunId === null)).toBe(true);
  const [{ count: before }] = await client`SELECT count(*)::int AS count FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  expect(before).toBe(first.createdCount);

  const second = await persistNativeEvidence(scope);
  expect(second.createdCount).toBe(0);
  const [{ count: after }] = await client`SELECT count(*)::int AS count FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  expect(after).toBe(before);
});

it("creates no duplicates when two collections run concurrently", async () => {
  await client`DELETE FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  const scope = { organizationId: org, projectId: project, incidentId, userId: null };
  const [a, b] = await Promise.all([persistNativeEvidence(scope), persistNativeEvidence(scope)]);
  expect(a.createdCount + b.createdCount).toBe(a.rows.length);
  const [{ total, distinct }] = await client`SELECT count(*)::int AS total, count(DISTINCT citation_result_hash)::int AS distinct FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  expect(total).toBe(distinct);
});

it("inserts nothing when already aborted", async () => {
  await client`DELETE FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  const controller = new AbortController();
  controller.abort();
  const result = await persistNativeEvidence({ organizationId: org, projectId: project, incidentId, userId: null, signal: controller.signal });
  expect(result.createdCount).toBe(0);
  const [{ count }] = await client`SELECT count(*)::int AS count FROM sre_evidence_items WHERE incident_id = ${incidentId}`;
  expect(count).toBe(0);
});
