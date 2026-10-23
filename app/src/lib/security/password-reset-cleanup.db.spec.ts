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
const logAuditEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) }));

import {
  retryPendingCredentialRevocations,
  revokeCredentialsAfterPasswordReset,
  revokeCredentialsAfterPasswordResetSafely,
} from "./password-reset-cleanup";

const execFileAsync = promisify(execFile);
const dbName = `reset_cleanup_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let aliceId: string;
let bobId: string;
let orgId: string;
let projectId: string;
let jobId: string;
const oauthClientId = "reset-cleanup-client";

async function seedCredentials(userId: string) {
  const tag = randomUUID();
  await client`INSERT INTO oauth_consent (client_id, user_id, reference_id, scopes, created_at, updated_at)
    VALUES (${oauthClientId}, ${userId}, ${projectId}, ARRAY['mcp:read'], now(), now())`;
  await client`INSERT INTO oauth_refresh_token (token, client_id, user_id, scopes, expires_at, created_at)
    VALUES (${`r-${tag}`}, ${oauthClientId}, ${userId}, ARRAY['mcp:read'], now() + interval '30 days', now())`;
  await client`INSERT INTO oauth_access_token (token, client_id, user_id, reference_id, scopes, expires_at, created_at)
    VALUES (${`a-${tag}`}, ${oauthClientId}, ${userId}, ${projectId}, ARRAY['mcp:read'], now() + interval '15 minutes', now())`;
  await client`INSERT INTO apikey (id, key, user_id, project_id, created_at, updated_at)
    VALUES (${randomUUID()}, ${`cli-${tag}`}, ${userId}, ${projectId}, now(), now())`;
  await client`INSERT INTO apikey (id, key, user_id, job_id, project_id, created_at, updated_at)
    VALUES (${randomUUID()}, ${`trigger-${tag}`}, ${userId}, ${jobId}, ${projectId}, now(), now())`;
  await client`INSERT INTO device_authorizations (device_code_hash, user_code_hash, client_id, status, expires_at, approved_user_id)
    VALUES (${`d-${tag}`.slice(0, 64)}, ${`u-${tag}`.slice(0, 64)}, 'supercheck-cli', 'approved', now() + interval '10 minutes', ${userId})`;
  await client`INSERT INTO verification (id, identifier, value, expires_at)
    VALUES (${randomUUID()}, ${`reset-password:${tag}`}, ${userId}, now() + interval '1 hour'),
           (${randomUUID()}, ${`email-verification:${tag}`}, ${userId}, now() + interval '1 hour')`;
}

async function counts(userId: string) {
  const [row] = await client<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::int FROM oauth_consent WHERE user_id = ${userId}) AS consents,
      (SELECT count(*)::int FROM oauth_refresh_token WHERE user_id = ${userId}) AS refresh,
      (SELECT count(*)::int FROM oauth_access_token WHERE user_id = ${userId}) AS access,
      (SELECT count(*)::int FROM apikey WHERE user_id = ${userId} AND job_id IS NULL) AS cli,
      (SELECT count(*)::int FROM apikey WHERE user_id = ${userId} AND job_id IS NOT NULL) AS trigger,
      (SELECT count(*)::int FROM device_authorizations WHERE approved_user_id = ${userId}) AS grants,
      (SELECT count(*)::int FROM verification WHERE value = ${userId} AND identifier LIKE 'reset-password:%') AS resets,
      (SELECT count(*)::int FROM verification WHERE value = ${userId} AND identifier LIKE 'email-verification:%') AS other`;
  return row;
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
  projectId = randomUUID();
  jobId = randomUUID();
  await client`INSERT INTO "user" (id, name, email) VALUES (${aliceId}, 'Alice', ${`a-${aliceId}@example.com`}), (${bobId}, 'Bob', ${`b-${bobId}@example.com`})`;
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'Org', ${`org-${orgId}`}, now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug, status) VALUES (${projectId}, ${orgId}, 'Alpha', ${`a-${projectId}`}, 'active')`;
  await client`INSERT INTO jobs (id, organization_id, project_id, name, created_by_user_id) VALUES (${jobId}, ${orgId}, ${projectId}, 'Nightly', ${aliceId})`;
  await client`INSERT INTO oauth_client (client_id, name, redirect_uris) VALUES (${oauthClientId}, 'Agent', ARRAY['http://127.0.0.1:9000/callback'])`;
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

describe("revokeCredentialsAfterPasswordReset", () => {
  it("ends the user's MCP, CLI, device-grant and reset credentials but keeps trigger keys, other verifications and other users", async () => {
    await seedCredentials(aliceId);
    await seedCredentials(bobId);

    await revokeCredentialsAfterPasswordReset(aliceId);

    expect(await counts(aliceId)).toEqual({ consents: 0, refresh: 0, access: 0, cli: 0, trigger: 1, grants: 0, resets: 0, other: 1 });
    expect(await counts(bobId)).toEqual({ consents: 1, refresh: 1, access: 1, cli: 1, trigger: 1, grants: 1, resets: 1, other: 1 });
  });

  it("does not fail the reset when cleanup fails: it audits, records a marker, and a later sweep finishes the job", async () => {
    const victim = randomUUID();
    await client`INSERT INTO "user" (id, name, email) VALUES (${victim}, 'Vic', ${`v-${victim}@example.com`})`;
    await seedCredentials(victim);
    // Make the cleanup transaction fail by breaking the table it deletes from first.
    await client.unsafe("ALTER TABLE oauth_access_token RENAME TO oauth_access_token_off");
    try {
      await expect(revokeCredentialsAfterPasswordResetSafely(victim)).resolves.toBeUndefined();
    } finally {
      await client.unsafe("ALTER TABLE oauth_access_token_off RENAME TO oauth_access_token");
    }
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "password_reset_credential_revocation_failed", userId: victim, success: false }));
    expect((await counts(victim)).cli).toBe(1);

    expect(await retryPendingCredentialRevocations()).toBe(1);
    expect(await counts(victim)).toMatchObject({ consents: 0, refresh: 0, access: 0, cli: 0, trigger: 1, grants: 0 });
    // The marker is consumed, so a second sweep does nothing.
    expect(await retryPendingCredentialRevocations()).toBe(0);
  });
});
