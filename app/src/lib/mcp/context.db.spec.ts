import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle>;
const mockProjectAccess = jest.fn();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/rbac/middleware", () => ({
  resolveProjectPermissionContext: (...args: unknown[]) => mockProjectAccess(...args),
  checkPermissionWithContext: () => true,
}));
import { MCP_PROJECT_CLAIM } from "./config";
import { resolveMcpCallContext } from "./context";

const name = `mcp_context_${randomUUID().replaceAll("-", "")}`;
const userId = randomUUID(); const projectId = randomUUID(); const organizationId = randomUUID();
const claims = { sub: userId, azp: "client", [MCP_PROJECT_CLAIM]: projectId };
let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  admin = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${name}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client, { schema });
  await client.unsafe(`CREATE TABLE "user" (id uuid PRIMARY KEY, banned boolean);
    CREATE TABLE oauth_client (client_id text PRIMARY KEY, disabled boolean);
    CREATE TABLE oauth_consent (user_id uuid, client_id text, reference_id text, scopes text[]);`);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (admin) { await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end({ timeout: 5 }); }
});
beforeEach(async () => {
  jest.clearAllMocks();
  await client`TRUNCATE "user", oauth_client, oauth_consent`;
  await client`INSERT INTO "user" VALUES (${userId},false)`;
  await client`INSERT INTO oauth_client VALUES ('client',false)`;
  await client`INSERT INTO oauth_consent VALUES (${userId},'client',${projectId},ARRAY['mcp:read'])`;
  mockProjectAccess.mockResolvedValue({ userId, organizationId, project: { id: projectId, userRole: "project_viewer" } });
});

it.each(["disable", "delete"])("rechecks a client after %s despite an unchanged token and consent", async action => {
  expect((await resolveMcpCallContext(claims)).projectId).toBe(projectId);
  if (action === "disable") await client`UPDATE oauth_client SET disabled=true WHERE client_id='client'`;
  else await client`DELETE FROM oauth_client WHERE client_id='client'`;
  mockProjectAccess.mockClear();
  await expect(resolveMcpCallContext(claims)).rejects.toMatchObject({ reason: "client_unavailable" });
  expect(mockProjectAccess).not.toHaveBeenCalled();
  expect(await client`SELECT * FROM oauth_consent`).toHaveLength(1);
});

it("still rechecks revoked consent after validating the client", async () => {
  await resolveMcpCallContext(claims);
  await client`DELETE FROM oauth_consent`;
  await expect(resolveMcpCallContext(claims)).rejects.toMatchObject({ reason: "consent_revoked" });
});
