/** @jest-environment node */
// A server outside UTC is where a timestamp-without-time-zone value read as local time goes wrong.
// Restored afterwards so it cannot leak into other specs that share this Jest worker.
const originalTimeZone = process.env.TZ;
process.env.TZ = "America/Los_Angeles";

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
  McpConnectionNotFoundError,
  listMcpConnections,
  revokeMcpConnection,
  verifiedHostForClientId,
} from "./connections";
import { cleanupMcpOAuthRows } from "./cleanup";

const execFileAsync = promisify(execFile);
const dbName = `mcp_connections_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

let aliceId: string;
let bobId: string;
let orgId: string;
let projectA: string;
let projectB: string;

const dcrClient = "dcr-client-abc";
const cimdClient = "https://agent.example.com/client.json";

async function seedConnection(opts: { userId: string; clientId: string; projectId: string }) {
  const [consent] = await client<{ id: string }[]>`
    INSERT INTO oauth_consent (client_id, user_id, reference_id, scopes, created_at, updated_at)
    VALUES (${opts.clientId}, ${opts.userId}, ${opts.projectId}, ARRAY['mcp:read'], now(), now())
    RETURNING id
  `;
  await client`
    INSERT INTO oauth_refresh_token (token, client_id, user_id, reference_id, scopes, expires_at, created_at)
    VALUES (${randomUUID()}, ${opts.clientId}, ${opts.userId}, ${opts.projectId}, ARRAY['mcp:read'],
            now() + interval '30 days', now())
  `;
  await client`
    INSERT INTO oauth_access_token (token, client_id, user_id, reference_id, scopes, expires_at, created_at)
    VALUES (${randomUUID()}, ${opts.clientId}, ${opts.userId}, ${opts.projectId}, ARRAY['mcp:read'],
            now() + interval '15 minutes', now())
  `;
  return consent.id;
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

  aliceId = randomUUID();
  bobId = randomUUID();
  orgId = randomUUID();
  projectA = randomUUID();
  projectB = randomUUID();
  await client`INSERT INTO "user" (id, name, email) VALUES (${aliceId}, 'Alice', ${`a-${aliceId}@example.com`}), (${bobId}, 'Bob', ${`b-${bobId}@example.com`})`;
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'Org', ${`org-${orgId}`}, now())`;
  await client`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${randomUUID()}, ${orgId}, ${aliceId}, 'org_owner', now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug, status) VALUES (${projectA}, ${orgId}, 'Alpha', ${`a-${projectA}`}, 'active'), (${projectB}, ${orgId}, 'Beta', ${`b-${projectB}`}, 'active')`;
  await client`INSERT INTO oauth_client (client_id, name, redirect_uris) VALUES (${dcrClient}, 'My Agent', ARRAY['http://127.0.0.1:9000/callback']), (${cimdClient}, 'Agent Co', ARRAY['https://agent.example.com/cb'])`;
}, 100000);

afterAll(async () => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

describe("MCP connections", () => {
  afterEach(async () => {
    await client`DELETE FROM oauth_access_token`;
    await client`DELETE FROM oauth_refresh_token`;
    await client`DELETE FROM oauth_consent`;
  });

  it("expires unused registrations and old tokens while preserving active connections and replay windows", async () => {
    const oldClient = `unused-${randomUUID()}`;
    await client`INSERT INTO oauth_client (client_id, redirect_uris, created_at)
      VALUES (${oldClient}, ARRAY['http://127.0.0.1/cb'], now() - interval '31 days')`;
    await client`UPDATE oauth_client SET created_at = now() - interval '31 days' WHERE client_id = ${dcrClient}`;
    const consent = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });
    const expiredToken = randomUUID();
    const replayToken = randomUUID();
    await client`INSERT INTO oauth_refresh_token (token, client_id, user_id, scopes, expires_at, created_at, rotated_at, rotation_replay_expires_at)
      VALUES (${expiredToken}, ${dcrClient}, ${aliceId}, ARRAY['mcp:read'], now() - interval '1 day', now() - interval '32 days', null, null),
      (${replayToken}, ${dcrClient}, ${aliceId}, ARRAY['mcp:read'], now() + interval '1 day', now() - interval '32 days', now(), now() + interval '1 minute')`;
    const expiredCode = randomUUID();
    await client`INSERT INTO verification (id, identifier, value, expires_at) VALUES (${expiredCode}, ${expiredCode}, 'expired-code', now() - interval '1 day')`;

    await cleanupMcpOAuthRows();

    expect(await client`SELECT client_id FROM oauth_client WHERE client_id = ${oldClient}`).toHaveLength(0);
    expect(await client`SELECT id FROM oauth_consent WHERE id = ${consent}`).toHaveLength(1);
    expect(await client`SELECT id FROM oauth_refresh_token WHERE token = ${expiredToken}`).toHaveLength(0);
    expect(await client`SELECT id FROM oauth_refresh_token WHERE token = ${replayToken}`).toHaveLength(1);
    expect(await client`SELECT id FROM verification WHERE identifier = ${expiredCode}`).toHaveLength(0);
    await client`UPDATE oauth_client SET created_at = now() WHERE client_id = ${dcrClient}`;
  });

  it("preserves a registration while another transaction is granting consent", async () => {
    const clientId = `concurrent-${randomUUID()}`;
    await client`INSERT INTO oauth_client (client_id, redirect_uris, created_at)
      VALUES (${clientId}, ARRAY['http://127.0.0.1/cb'], now() - interval '31 days')`;
    await client.begin(async (tx) => {
      await tx`INSERT INTO oauth_consent (client_id, user_id, reference_id, scopes, created_at, updated_at)
        VALUES (${clientId}, ${aliceId}, ${projectA}, ARRAY['mcp:read'], now(), now())`;
      await cleanupMcpOAuthRows();
      expect(await tx`SELECT id FROM oauth_client WHERE client_id = ${clientId}`).toHaveLength(1);
    });
    await cleanupMcpOAuthRows();
    expect(await client`SELECT id FROM oauth_consent WHERE client_id = ${clientId}`).toHaveLength(1);
  });

  it("lists a user's connections with the project name and a verified host only for metadata-document clients", async () => {
    const dcr = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });
    const cimdId = await seedConnection({ userId: aliceId, clientId: cimdClient, projectId: projectB });

    const connections = await listMcpConnections(aliceId);
    const byId = new Map(connections.map((c) => [c.id, c]));

    expect(byId.get(dcr)).toMatchObject({
      clientName: "My Agent",
      projectName: "Alpha",
      verifiedHost: null,
      redirectHosts: ["127.0.0.1:9000"],
    });
    expect(byId.get(cimdId)).toMatchObject({
      clientName: "Agent Co",
      projectName: "Beta",
      verifiedHost: "agent.example.com",
    });
    // The refresh token was created a moment ago; a timezone mix-up would be hours off.
    const lastActive = byId.get(dcr)?.lastActiveAt;
    expect(lastActive).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - (lastActive as Date).getTime())).toBeLessThan(60_000);

    await revokeMcpConnection({ userId: aliceId, consentId: dcr });
    await revokeMcpConnection({ userId: aliceId, consentId: cimdId });
  });

  it("hides the name of a project the user can no longer see, but still lists the connection so it can be disconnected", async () => {
    const id = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });
    await client`DELETE FROM member WHERE user_id = ${aliceId}`;
    try {
      const [connection] = await listMcpConnections(aliceId);
      expect(connection.id).toBe(id);
      expect(connection.projectId).toBe(projectA);
      expect(connection.projectName).toBeNull();
    } finally {
      await client`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${randomUUID()}, ${orgId}, ${aliceId}, 'org_owner', now())`;
    }
  });

  it("never lists another user's connections", async () => {
    const id = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });
    expect(await listMcpConnections(bobId)).toEqual([]);
    await revokeMcpConnection({ userId: aliceId, consentId: id });
  });

  it("disconnects by deleting the refresh tokens, and leaves the same client's other project connected", async () => {
    const id = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });
    // A second connection of the same client to another project must survive.
    const other = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectB });

    await revokeMcpConnection({ userId: aliceId, consentId: id });

    const consents = await client<{ id: string }[]>`SELECT id FROM oauth_consent WHERE user_id = ${aliceId}`;
    expect(consents.map((c) => c.id)).toEqual([other]);

    // Deleted, not flagged: Better Auth treats a replayed *revoked* token as theft and wipes every
    // refresh token the client holds for the user, which would disconnect project B as well.
    const refresh = await client<{ reference_id: string; revoked: boolean }[]>`
      SELECT reference_id, revoked IS NOT NULL AS revoked FROM oauth_refresh_token WHERE user_id = ${aliceId}
    `;
    expect(refresh).toEqual([{ reference_id: projectB, revoked: false }]);

    const access = await client<{ reference_id: string }[]>`
      SELECT reference_id FROM oauth_access_token WHERE user_id = ${aliceId}
    `;
    expect(access.map((a) => a.reference_id)).toEqual([projectB]);

    await revokeMcpConnection({ userId: aliceId, consentId: other });
  });

  it("refuses to revoke someone else's connection or an unknown one, and leaves it intact", async () => {
    const id = await seedConnection({ userId: aliceId, clientId: dcrClient, projectId: projectA });

    await expect(revokeMcpConnection({ userId: bobId, consentId: id })).rejects.toBeInstanceOf(
      McpConnectionNotFoundError,
    );
    await expect(
      revokeMcpConnection({ userId: aliceId, consentId: randomUUID() }),
    ).rejects.toBeInstanceOf(McpConnectionNotFoundError);

    const [{ count }] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM oauth_consent WHERE id = ${id}
    `;
    expect(count).toBe(1);
    await revokeMcpConnection({ userId: aliceId, consentId: id });
  });
});

describe("verifiedHostForClientId", () => {
  it.each([
    ["https://agent.example.com/client.json", "agent.example.com"],
    ["https://agent.example.com:8443/c", "agent.example.com:8443"],
    ["xtbgpiwREyXAXdkPuqeMjepuIVFVNuDN", null],
    ["http://agent.example.com/client.json", null],
    ["not a url", null],
  ])("%s -> %p", (clientId, expected) => {
    expect(verifiedHostForClientId(clientId)).toBe(expected);
  });
});
