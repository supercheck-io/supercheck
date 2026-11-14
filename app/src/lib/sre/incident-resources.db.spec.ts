/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));

import { addIncidentResources, findOpenIncidentListingMonitor, resolveIncidentResources } from "./incident-resources";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `incident_resources_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const org = uuidv7();
const otherOrg = uuidv7();
const project = uuidv7();
const otherProject = uuidv7();
const foreignProject = uuidv7();
const monitor = uuidv7();
const lateMonitor = uuidv7();
const otherProjectMonitor = uuidv7();
const service = uuidv7();
const otherProjectService = uuidv7();
const manual = uuidv7();
const resolvedManual = uuidv7();
const otherProjectIncident = uuidv7();

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

  for (const [id, slug] of [[org, "o"], [otherOrg, "x"]]) {
    await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${id}, ${slug}, ${id}, now())`;
  }
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project}), (${otherProject}, ${org}, 'q', ${otherProject}), (${foreignProject}, ${otherOrg}, 'f', ${foreignProject})`;
  await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target) VALUES
    (${monitor}, ${org}, ${project}, 'Checkout', 'http_request', 'https://example.com'),
    (${lateMonitor}, ${org}, ${project}, 'Late', 'http_request', 'https://example.com/late'),
    (${otherProjectMonitor}, ${org}, ${otherProject}, 'Other', 'http_request', 'https://example.com/other')`;
  await client`INSERT INTO sre_services (id, organization_id, project_id, name) VALUES (${service}, ${org}, ${project}, 'Checkout API'), (${otherProjectService}, ${org}, ${otherProject}, 'Other API')`;
  await client`INSERT INTO sre_incidents (incident_number, id, organization_id, project_id, title, severity, status, resolved_at) VALUES
    (1, ${manual}, ${org}, ${project}, 'Declared', 'sev2', 'triggered', NULL),
    (2, ${resolvedManual}, ${org}, ${project}, 'Old', 'sev2', 'resolved', now()),
    (3, ${otherProjectIncident}, ${org}, ${otherProject}, 'Elsewhere', 'sev2', 'triggered', NULL)`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("resolves only services and monitors of the caller's org and project", async () => {
  const scope = { organizationId: org, projectId: project };
  expect(await resolveIncidentResources(mockDatabase as never, scope, { serviceIds: [service], monitorIds: [monitor] })).toEqual([
    { type: "service", id: service, name: "Checkout API" },
    { type: "monitor", id: monitor, name: "Checkout" },
  ]);
  expect(await resolveIncidentResources(mockDatabase as never, scope, { serviceIds: [otherProjectService], monitorIds: [] })).toBeNull();
  expect(await resolveIncidentResources(mockDatabase as never, scope, { serviceIds: [], monitorIds: [otherProjectMonitor] })).toBeNull();
  expect(await resolveIncidentResources(mockDatabase as never, { organizationId: otherOrg, projectId: foreignProject }, { serviceIds: [], monitorIds: [monitor] })).toBeNull();
});

it("adds each resource once (unique per incident)", async () => {
  const refs = [{ type: "monitor" as const, id: monitor, name: "Checkout" }, { type: "service" as const, id: service, name: "Checkout API" }];
  expect(await addIncidentResources(mockDatabase as never, manual, refs)).toHaveLength(2);
  expect(await addIncidentResources(mockDatabase as never, manual, refs)).toEqual([]);
  // The same monitor listed on a resolved incident and on another project's incident never matches below.
  await addIncidentResources(mockDatabase as never, resolvedManual, [refs[0]]);
  await addIncidentResources(mockDatabase as never, otherProjectIncident, [{ type: "monitor", id: lateMonitor, name: "Late" }]);
});

it("finds the open declared incident by monitor, and by a service mapped after the incident was declared (I4)", async () => {
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: org, projectId: project, monitorId: monitor })).toMatchObject({ id: manual });
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: org, projectId: project, monitorId: lateMonitor })).toBeNull();
  await client`INSERT INTO sre_service_resources (id, service_id, resource_type, resource_id) VALUES (${uuidv7()}, ${service}, 'monitor', ${lateMonitor})`;
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: org, projectId: project, monitorId: lateMonitor })).toMatchObject({ id: manual });
});

it("never matches another project's or org's incident, or a resolved one", async () => {
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: org, projectId: otherProject, monitorId: monitor })).toBeNull();
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: otherOrg, projectId: foreignProject, monitorId: lateMonitor })).toBeNull();
  await client`UPDATE sre_incidents SET status = 'resolved', resolved_at = now() WHERE id = ${manual}`;
  expect(await findOpenIncidentListingMonitor(mockDatabase as never, { organizationId: org, projectId: project, monitorId: monitor })).toBeNull();
});
