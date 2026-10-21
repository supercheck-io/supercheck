/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
// The real Better Auth instance binds the database at import time; nothing here needs it.
jest.mock("@/utils/auth", () => ({ auth: { api: {} } }));

import {
  McpProjectAccessError,
  assertCanConnectProject,
  resolveConsentProject,
  runWithConsentProject,
} from "./connect-project";

const execFileAsync = promisify(execFile);
const dbName = `mcp_selection_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

let userId: string;
let strangerId: string;
let orgId: string;
let projectA: string;
let projectB: string;
let foreignProject: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" } as NodeJS.ProcessEnv,
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

  userId = randomUUID();
  strangerId = randomUUID();
  orgId = randomUUID();
  const otherOrg = randomUUID();
  projectA = randomUUID();
  projectB = randomUUID();
  foreignProject = randomUUID();
  await client`INSERT INTO "user" (id, name, email) VALUES
    (${userId}, 'U', ${`u-${userId}@example.com`}), (${strangerId}, 'S', ${`s-${strangerId}@example.com`})`;
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES
    (${orgId}, 'Org', ${`org-${orgId}`}, now()), (${otherOrg}, 'Other', ${`other-${otherOrg}`}, now())`;
  await client`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES
    (${randomUUID()}, ${orgId}, ${userId}, 'project_viewer', now()),
    (${randomUUID()}, ${otherOrg}, ${strangerId}, 'org_owner', now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug, status) VALUES
    (${projectA}, ${orgId}, 'Alpha', ${`a-${projectA}`}, 'active'),
    (${projectB}, ${orgId}, 'Beta', ${`b-${projectB}`}, 'active'),
    (${foreignProject}, ${otherOrg}, 'Foreign', ${`f-${foreignProject}`}, 'active')`;
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

const resolveFor = (userId: string, projectId: string, who = userId) =>
  runWithConsentProject({ userId, projectId }, () => resolveConsentProject({ userId: who }));

describe("the connect screen's project choice", () => {
  it("accepts a project the user can view, even as a plain project viewer", async () => {
    await expect(assertCanConnectProject(userId, projectA)).resolves.toBeUndefined();
    await expect(resolveFor(userId, projectA)).resolves.toBe(projectA);
  });

  it("refuses a project in another organization", async () => {
    await expect(assertCanConnectProject(userId, foreignProject)).rejects.toBeInstanceOf(McpProjectAccessError);
    await expect(resolveFor(userId, foreignProject)).resolves.toBeUndefined();
  });

  it("is not usable by another user", async () => {
    await expect(resolveFor(userId, projectA, strangerId)).resolves.toBeUndefined();
  });

  it("stops granting a project once the user loses access to it", async () => {
    await client`UPDATE projects SET status = 'archived' WHERE id = ${projectA}`;
    try {
      await expect(resolveFor(userId, projectA)).resolves.toBeUndefined();
    } finally {
      await client`UPDATE projects SET status = 'active' WHERE id = ${projectA}`;
    }
  });

  it("keeps two approvals in flight apart", async () => {
    const slow = async (delayMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return resolveConsentProject({ userId });
    };
    const results = await Promise.all([
      runWithConsentProject({ userId, projectId: projectA }, () => slow(30)),
      runWithConsentProject({ userId, projectId: projectB }, () => slow(1)),
    ]);
    expect(results).toEqual([projectA, projectB]);
  });
});
