/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

let mockDatabase: ReturnType<typeof drizzle>;
let mockAllowed = true;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () => mockAllowed
    ? { success: true, context: { organizationId: "org-1", project: { id: "project-1" } } }
    : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));

const databaseName = `open_incidents_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  await client.unsafe(`
    CREATE TABLE sre_incidents (
      id text PRIMARY KEY, organization_id text, project_id text, incident_number integer,
      title text, severity text, status text NOT NULL, primary_service_id text,
      root_cause_summary text, confidence_score numeric, resolved_at timestamptz,
      assignee_user_id text, acknowledged_at timestamptz, acknowledged_by_user_id text,
      commander_user_id text, mitigated_at timestamptz, resolution_summary text,
      created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE sre_services (id text PRIMARY KEY, name text);
    CREATE TABLE sre_incident_alerts (id text PRIMARY KEY, incident_id text);
    INSERT INTO sre_incidents(id, organization_id, project_id, incident_number, title, severity, status, updated_at)
      SELECT 'resolved-' || n, 'org-1', 'project-1', n, 'Resolved', 'sev3', 'resolved', '2026-10-25'::timestamptz
      FROM generate_series(1, 501) n;
    INSERT INTO sre_incidents(id, organization_id, project_id, incident_number, title, severity, status, updated_at) VALUES
      ('older-open', 'org-1', 'project-1', 502, 'Needs attention', 'sev1', 'investigating', '2026-10-01'),
      ('foreign-project', 'org-1', 'project-2', 503, 'Other project', 'sev1', 'triggered', '2026-10-26'),
      ('foreign-org', 'org-2', 'project-1', 504, 'Other org', 'sev1', 'triggered', '2026-10-26');
  `);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});
beforeEach(() => { mockAllowed = true; });

async function list(query: string) {
  return GET(new NextRequest(`https://example.com/api/sre/incidents${query}`));
}

it("returns an older open incident despite 501 newer resolved incidents, excluding other tenants", async () => {
  const response = await list("?status=open");
  expect(response.status).toBe(200);
  expect((await response.json()).incidents.map((row: { id: string }) => row.id)).toEqual(["older-open"]);
});
it.each(["", "?status=resolved"])("preserves the 500-row cap for %s", async (query) => {
  const incidents = (await (await list(query)).json()).incidents;
  expect(incidents).toHaveLength(500);
  expect(incidents.every((row: { status: string }) => row.status === "resolved")).toBe(true);
});
it("combines the open filter with incident number and severity", async () => {
  expect((await (await list("?status=open&incidentNumber=502&severity=sev1")).json()).incidents).toHaveLength(1);
  expect((await (await list("?status=open&severity=sev4")).json()).incidents).toEqual([]);
});
it("denies unauthorized requests", async () => {
  mockAllowed = false;
  expect((await list("?status=open")).status).toBe(403);
});
