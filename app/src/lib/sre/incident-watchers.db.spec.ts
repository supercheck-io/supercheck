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

import { listProjectAdmins, listWatchers } from "./incident-watchers";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `watchers_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const org = uuidv7();
const project = uuidv7();
const incident = uuidv7();
const users = Object.fromEntries(["owner", "viewer", "editor", "editorNoRow", "staleAdmin", "admin"].map((name) => [name, uuidv7()]));

async function person(name: keyof typeof users, orgRole: string, projectRole?: string) {
  const id = users[name];
  await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${id}, ${name}, ${`${name}@example.com`}, true, now(), now())`;
  await client`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${uuidv7()}, ${org}, ${id}, ${orgRole}, now())`;
  if (projectRole) await client`INSERT INTO project_members (id, user_id, project_id, role) VALUES (${randomUUID()}, ${id}, ${project}, ${projectRole})`;
  await client`INSERT INTO sre_incident_watchers (incident_id, user_id) VALUES (${incident}, ${id})`;
}

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
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, 'o', ${org}, now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project})`;
  await client`INSERT INTO sre_incidents (incident_number, id, organization_id, project_id, title, severity, status) VALUES (1, ${incident}, ${org}, ${project}, 't', 'sev3', 'triggered')`;
  await person("owner", "org_owner");
  await person("viewer", "project_viewer"); // org-level viewers see every project without a project row
  await person("editor", "project_editor", "project_editor");
  await person("editorNoRow", "project_editor"); // an editor needs a project row to see this project
  await person("staleAdmin", "project_viewer", "project_admin"); // org role was downgraded, project row is stale
  await person("admin", "project_admin", "project_admin");
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("emails watchers who can see the project, including org-level viewers, and not editors without access", async () => {
  const watchers = await listWatchers(org, project, incident);
  expect(watchers.map((row) => row.name).sort()).toEqual(["admin", "editor", "owner", "staleAdmin", "viewer"]);
});

it("falls back only to current owners and admins, not a stale project_admin row", async () => {
  const admins = await listProjectAdmins(org, project);
  expect(admins.map((row) => row.name).sort()).toEqual(["admin", "owner"]);
});
