/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { listServiceDependencySuggestions } from "./service-dependency-suggestions";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));

const ORG = randomUUID();
const PROJECT = randomUUID();
const SERVICE = randomUUID();
const OTHER = randomUUID();

const databaseName = `service_suggestions_${randomUUID().replaceAll("-", "")}`;
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
    CREATE TABLE sre_service_discovery_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
      suggestion_type varchar(20) NOT NULL, suggestion_data jsonb NOT NULL, source varchar(50) NOT NULL,
      confidence numeric(5,4), status varchar(15) NOT NULL DEFAULT 'pending', approved_by uuid,
      approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const insert = (id: string, org: string, project: string, type: string, data: object, createdAt: string) =>
    client`INSERT INTO sre_service_discovery_suggestions (id, organization_id, project_id, suggestion_type, suggestion_data, source, created_at)
      VALUES (${id}, ${org}, ${project}, ${type}, ${JSON.stringify(data)}::jsonb, 'traces', ${createdAt})`;
  // The service's own suggestions are the oldest rows; 150 newer ones name other services.
  await insert(randomUUID(), ORG, PROJECT, "add_dependency", { sourceServiceId: SERVICE, targetServiceId: OTHER }, "2026-01-01");
  await insert(randomUUID(), ORG, PROJECT, "add_dependency", { sourceServiceId: OTHER, targetServiceId: SERVICE }, "2026-01-02");
  for (let n = 0; n < 150; n += 1) {
    await insert(randomUUID(), ORG, PROJECT, "add_dependency", { sourceServiceId: OTHER, targetServiceId: randomUUID() }, "2026-02-01");
  }
  await insert(randomUUID(), ORG, PROJECT, "merge_service", { sourceServiceId: SERVICE, targetServiceId: OTHER }, "2026-03-01");
  await insert(randomUUID(), randomUUID(), PROJECT, "add_dependency", { sourceServiceId: SERVICE, targetServiceId: OTHER }, "2026-03-01");
  await insert(randomUUID(), ORG, randomUUID(), "add_dependency", { sourceServiceId: SERVICE, targetServiceId: OTHER }, "2026-03-01");
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("returns the service's suggestions behind more than 100 newer ones, newest first, in this tenant only", async () => {
  const rows = await listServiceDependencySuggestions({ organizationId: ORG, projectId: PROJECT, serviceId: SERVICE });
  expect(rows.map((row) => row.suggestionData)).toEqual([
    { sourceServiceId: OTHER, targetServiceId: SERVICE },
    { sourceServiceId: SERVICE, targetServiceId: OTHER },
  ]);
});

it("keeps the row cap", async () => {
  const rows = await listServiceDependencySuggestions({ organizationId: ORG, projectId: PROJECT, serviceId: OTHER, limit: 100 });
  expect(rows).toHaveLength(100);
});
