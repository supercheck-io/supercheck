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
  clearProjectSelection,
  readProjectSelection,
  saveProjectSelection,
} from "./project-selection";

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
const sessionId = randomUUID();

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

afterEach(async () => {
  await client`DELETE FROM verification WHERE identifier LIKE 'mcp-project:%'`;
});

describe("the connect screen's project choice", () => {
  it("round-trips a project the user can view, even as a plain project viewer", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectA });
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBe(projectA);
  });

  it("refuses a project in another organization, and stores nothing", async () => {
    await expect(saveProjectSelection({ sessionId, userId, projectId: foreignProject })).rejects.toBeInstanceOf(
      McpProjectAccessError,
    );
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBeUndefined();
  });

  it("is not readable by another user, even with the same session id", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectA });
    await expect(readProjectSelection({ sessionId, userId: strangerId })).resolves.toBeUndefined();
  });

  it("keeps only the latest choice for a session", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectA });
    await saveProjectSelection({ sessionId, userId, projectId: projectB });
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBe(projectB);
    const rows = await client`SELECT 1 FROM verification WHERE identifier = ${`mcp-project:${sessionId}`}`;
    expect(rows).toHaveLength(1);
  });

  it("is only cleared by the caller that saved that exact choice", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectB });
    // Another tab finishing with a different project must not delete this one.
    await clearProjectSelection({ sessionId, userId, projectId: projectA });
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBe(projectB);
    await clearProjectSelection({ sessionId, userId, projectId: projectB });
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBeUndefined();
  });

  it("stops granting a project once the user loses access to it", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectA });
    await client`UPDATE projects SET status = 'archived' WHERE id = ${projectA}`;
    try {
      await expect(readProjectSelection({ sessionId, userId })).resolves.toBeUndefined();
    } finally {
      await client`UPDATE projects SET status = 'active' WHERE id = ${projectA}`;
    }
  });

  it("expires after its lifetime", async () => {
    await saveProjectSelection({ sessionId, userId, projectId: projectA });
    await client`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE identifier = ${`mcp-project:${sessionId}`}`;
    await expect(readProjectSelection({ sessionId, userId })).resolves.toBeUndefined();
  });
});
