/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { v7 as uuidv7 } from "uuid";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));

jest.mock("@/lib/middleware/plan-enforcement", () => ({ countPlanMonitors: jest.fn(), checkMonitorLimit: jest.fn() }));

import { claimAiRun, releaseAiRun, saveScanResult } from "./setup-state";
import { copyConnectors, copyProviders } from "./copy";
import { decryptNotificationProviderConfig, encryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { decryptConnectorCredential, encryptConnectorCredential } from "@/lib/sre/connectors/credential-vault";

process.env.SECRET_ENCRYPTION_KEY ??= "test-secret-encryption-key-0123456789abcdef";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `copy_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const [orgA, orgB, projSrc, projTgt, projOther] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const u1 = uuidv7();
const webhook = "https://hooks.slack.com/services/T000/B000/SECRETVALUE";
const scope = { organizationId: orgA, sourceProjectId: projSrc, targetProjectId: projTgt, userId: u1 };

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
  client = postgres(url.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgA}, 'a', ${orgA}, now()), (${orgB}, 'b', ${orgB}, now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${projSrc}, ${orgA}, 'src', ${projSrc}), (${projTgt}, ${orgA}, 'tgt', ${projTgt}), (${projOther}, ${orgB}, 'other', ${projOther})`;
  await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${u1}, 'Una', 'u1@example.com', true, now(), now())`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

afterEach(async () => {
  await client`DELETE FROM notification_providers`;
  await client`DELETE FROM external_connectors`;
});

async function seedProvider(org: string, project: string, name: string, url = webhook) {
  const [row] = await mockDatabase
    .insert(schema.notificationProviders)
    .values({
      organizationId: org,
      projectId: project,
      name,
      type: "slack",
      config: encryptNotificationProviderConfig({ webhookUrl: url }, project),
      createdByUserId: u1,
    })
    .returning();
  return row;
}

// A public IP literal keeps the endpoint policy offline (no DNS).
async function seedConnector(org: string, project: string, name: string, over: { endpoint?: string; token?: string; riskLevel?: "low" | "medium" | "high" } = {}) {
  const id = uuidv7();
  await mockDatabase.insert(schema.externalConnectors).values({
    id, organizationId: org, projectId: project, name, type: "prometheus", config: { endpointUrl: over.endpoint ?? "https://93.184.216.34" },
    ...(over.riskLevel ? { riskLevel: over.riskLevel } : {}),
  });
  const enc = encryptConnectorCredential({ token: over.token ?? "tok-secret" }, { organizationId: org, projectId: project, connectorId: id });
  await mockDatabase.insert(schema.externalConnectorCredentials).values({ connectorId: id, credentialType: "api_key", ...enc });
  return id;
}

describe("copyProviders", () => {
  it("re-encrypts with the target key context", async () => {
    const src = await seedProvider(orgA, projSrc, "Slack ops");
    const [res] = await copyProviders(scope, [src.id]);
    expect(res).toMatchObject({ sourceId: src.id, status: "copied" });
    const [row] = await mockDatabase.select().from(schema.notificationProviders).where(eq(schema.notificationProviders.id, res.id!));
    expect(row.projectId).toBe(projTgt);
    expect(decryptNotificationProviderConfig(row.config, projTgt)).toEqual({ webhookUrl: webhook });
    expect(() => decryptNotificationProviderConfig(row.config, projSrc)).toThrow();
    expect(JSON.stringify(res)).not.toContain("SECRETVALUE");
  });
  it("adopts a same type+name provider instead of duplicating", async () => {
    const src = await seedProvider(orgA, projSrc, "Slack ops");
    const existing = await seedProvider(orgA, projTgt, "Slack ops");
    const [res] = await copyProviders(scope, [src.id]);
    expect(res).toMatchObject({ status: "adopted", id: existing.id });
    expect(await mockDatabase.select().from(schema.notificationProviders).where(eq(schema.notificationProviders.projectId, projTgt))).toHaveLength(1);
  });
  it("does not adopt a same-name channel that points somewhere else: copies under a unique name, then adopts that copy", async () => {
    const other = "https://hooks.slack.com/services/T111/B111/OTHERSECRET";
    const src = await seedProvider(orgA, projSrc, "Slack ops");
    const existing = await seedProvider(orgA, projTgt, "Slack ops", other);
    const [first] = await copyProviders(scope, [src.id]);
    expect(first).toMatchObject({ status: "copied", name: "Slack ops (copied)" });
    expect(first.id).not.toBe(existing.id);
    const [again] = await copyProviders(scope, [src.id]);
    expect(again).toMatchObject({ status: "adopted", id: first.id, name: "Slack ops (copied)" });
    await seedProvider(orgA, projTgt, "Slack ops (copied 2)", other);
    await mockDatabase.update(schema.notificationProviders).set({ config: encryptNotificationProviderConfig({ webhookUrl: other }, projTgt) }).where(eq(schema.notificationProviders.id, first.id!));
    const [third] = await copyProviders(scope, [src.id]);
    expect(third).toMatchObject({ status: "copied", name: "Slack ops (copied 3)" });
    expect(JSON.stringify([first, again, third])).not.toContain("SECRET");
  });
  it("fails a channel whose config no longer passes validation, leaving no row", async () => {
    const src = await seedProvider(orgA, projSrc, "Bad hook", "https://evil.example.com/hook");
    const [res] = await copyProviders(scope, [src.id]);
    expect(res).toMatchObject({ status: "failed", error: "This channel's settings no longer pass validation" });
    expect(await mockDatabase.select().from(schema.notificationProviders).where(eq(schema.notificationProviders.projectId, projTgt))).toHaveLength(0);
  });
  it("concurrent copies of the same provider create one row", async () => {
    const src = await seedProvider(orgA, projSrc, "Slack ops");
    const results = await Promise.all([copyProviders(scope, [src.id]), copyProviders(scope, [src.id]), copyProviders(scope, [src.id])]);
    expect(results.flat().map((r) => r.status).sort()).toEqual(["adopted", "adopted", "copied"]);
    expect(await mockDatabase.select().from(schema.notificationProviders).where(eq(schema.notificationProviders.projectId, projTgt))).toHaveLength(1);
  });
  it("fails for a source in another org or another project, without copying", async () => {
    const foreign = await seedProvider(orgB, projOther, "Foreign");
    const wrongProject = await seedProvider(orgA, projTgt, "Not in source");
    const results = await copyProviders(scope, [foreign.id, wrongProject.id, uuidv7()]);
    expect(results.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(await mockDatabase.select().from(schema.notificationProviders).where(eq(schema.notificationProviders.projectId, projOther))).toHaveLength(1);
  });
  it("one failing item does not stop the next", async () => {
    const good = await seedProvider(orgA, projSrc, "Good");
    const results = await copyProviders(scope, [uuidv7(), good.id]);
    expect(results.map((r) => r.status)).toEqual(["failed", "copied"]);
  });
  it("reports a failure with a fixed message when the stored config cannot be decrypted", async () => {
    const [bad] = await mockDatabase
      .insert(schema.notificationProviders)
      .values({ organizationId: orgA, projectId: projSrc, name: "Bad", type: "slack", config: encryptNotificationProviderConfig({ webhookUrl: webhook }, "other-context") })
      .returning();
    const [res] = await copyProviders(scope, [bad.id]);
    expect(res).toEqual({ sourceId: bad.id, status: "failed", error: "Could not copy this item" });
  });
});

describe("copyConnectors", () => {
  it("re-encrypts the credential with a context for the new connector id and target project", async () => {
    const src = await seedConnector(orgA, projSrc, "Prom");
    const [res] = await copyConnectors(scope, [src]);
    expect(res).toMatchObject({ status: "copied" });
    expect(res.id).not.toBe(src);
    const [cred] = await mockDatabase.select().from(schema.externalConnectorCredentials).where(eq(schema.externalConnectorCredentials.connectorId, res.id!));
    const tgtCtx = { organizationId: orgA, projectId: projTgt, connectorId: res.id! };
    expect(decryptConnectorCredential(cred.encryptedCredential, tgtCtx)).toEqual({ token: "tok-secret" });
    expect(() => decryptConnectorCredential(cred.encryptedCredential, { organizationId: orgA, projectId: projSrc, connectorId: src })).toThrow();
    expect(cred.encryptionKeyContext).toBe(`sre_connector:${orgA}:${projTgt}:${res.id}`);
    const [row] = await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.id, res.id!));
    expect(row).toMatchObject({ projectId: projTgt, permissionLevel: "read", sideEffectLevel: "none", status: "configured" });
  });
  it("concurrent copies of the same connector create one row", async () => {
    const src = await seedConnector(orgA, projSrc, "Prom");
    const results = await Promise.all([copyConnectors(scope, [src]), copyConnectors(scope, [src])]);
    expect(results.flat().map((r) => r.status).sort()).toEqual(["adopted", "copied"]);
    expect(await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.projectId, projTgt))).toHaveLength(1);
  });
  it("adopts a same type+name connector", async () => {
    const src = await seedConnector(orgA, projSrc, "Prom");
    const existing = await seedConnector(orgA, projTgt, "Prom");
    expect(await copyConnectors(scope, [src])).toEqual([{ sourceId: src, id: existing, status: "adopted", name: "Prom", type: "prometheus" }]);
  });
  it("does not adopt a same-name connector with another endpoint or credential", async () => {
    const src = await seedConnector(orgA, projSrc, "GitHub");
    const diffEndpoint = await seedConnector(orgA, projTgt, "GitHub", { endpoint: "https://93.184.216.35" });
    const [first] = await copyConnectors(scope, [src]);
    expect(first).toMatchObject({ status: "copied", name: "GitHub (copied)" });
    expect(first.id).not.toBe(diffEndpoint);
    expect(await copyConnectors(scope, [src])).toEqual([{ sourceId: src, id: first.id, status: "adopted", name: "GitHub (copied)", type: "prometheus" }]);
    const src2 = await seedConnector(orgA, projSrc, "Loki");
    await seedConnector(orgA, projTgt, "Loki", { token: "different-token" });
    expect((await copyConnectors(scope, [src2]))[0]).toMatchObject({ status: "copied", name: "Loki (copied)" });
  });
  it("keeps the source's risk level and read-only permissions", async () => {
    const src = await seedConnector(orgA, projSrc, "Risky", { riskLevel: "high" });
    const [res] = await copyConnectors(scope, [src]);
    const [row] = await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.id, res.id!));
    expect(row).toMatchObject({ riskLevel: "high", permissionLevel: "read", sideEffectLevel: "none" });
  });
  it("fails a connector whose endpoint the create policy refuses, or whose agent is disabled", async () => {
    const priv = await seedConnector(orgA, projSrc, "Internal", { endpoint: "https://10.0.0.5" });
    const [res] = await copyConnectors(scope, [priv]);
    expect(res).toMatchObject({ status: "failed", error: "This connector's endpoint is not allowed in the target project" });
    const agentId = uuidv7();
    await client`INSERT INTO private_agents (id, organization_id, project_id, name, status) VALUES (${agentId}, ${orgA}, NULL, 'off', 'disabled')`;
    const id = uuidv7();
    await mockDatabase.insert(schema.externalConnectors).values({ id, organizationId: orgA, projectId: projSrc, name: "Agented off", type: "prometheus", privateAgentId: agentId });
    expect((await copyConnectors(scope, [id]))[0]).toMatchObject({ status: "failed" });
    expect(await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.projectId, projTgt))).toHaveLength(0);
    await client`DELETE FROM external_connectors`;
    await client`DELETE FROM private_agents WHERE id = ${agentId}`;
  });
  it("rejects cross-org and wrong-project sources", async () => {
    const foreign = await seedConnector(orgB, projOther, "Foreign");
    const results = await copyConnectors(scope, [foreign]);
    expect(results[0].status).toBe("failed");
  });
  it("copies a connector that needs credentials but has none as missing_credentials, like a new one", async () => {
    const id = uuidv7();
    await mockDatabase.insert(schema.externalConnectors).values({ id, organizationId: orgA, projectId: projSrc, name: "NoCred", type: "datadog", status: "valid" });
    const [res] = await copyConnectors(scope, [id]);
    expect(res.status).toBe("copied");
    const [row] = await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.id, res.id!));
    expect(row.status).toBe("missing_credentials");
  });
  it("fails when the private agent is scoped to another project, leaving no row", async () => {
    const agentId = uuidv7();
    await client`INSERT INTO private_agents (id, organization_id, project_id, name, status) VALUES (${agentId}, ${orgA}, ${projSrc}, 'agent', 'connected')`;
    const id = uuidv7();
    await mockDatabase.insert(schema.externalConnectors).values({ id, organizationId: orgA, projectId: projSrc, name: "Agented", type: "prometheus", privateAgentId: agentId });
    const [res] = await copyConnectors(scope, [id]);
    expect(res.status).toBe("failed");
    expect(await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.projectId, projTgt))).toHaveLength(0);
    await client`DELETE FROM external_connectors`;
    await client`DELETE FROM private_agents WHERE id = ${agentId}`;
  });
  it("keeps an org-level private agent on the copy", async () => {
    const agentId = uuidv7();
    await client`INSERT INTO private_agents (id, organization_id, project_id, name, status) VALUES (${agentId}, ${orgA}, NULL, 'org agent', 'connected')`;
    const id = uuidv7();
    await mockDatabase.insert(schema.externalConnectors).values({ id, organizationId: orgA, projectId: projSrc, name: "Agented", type: "prometheus", privateAgentId: agentId });
    const [res] = await copyConnectors(scope, [id]);
    expect(res.status).toBe("copied");
    const [row] = await mockDatabase.select().from(schema.externalConnectors).where(eq(schema.externalConnectors.id, res.id!));
    expect(row.privateAgentId).toBe(agentId);
    await client`DELETE FROM external_connectors`;
    await client`DELETE FROM private_agents WHERE id = ${agentId}`;
  });
});

describe("AI daily claim", () => {
  afterEach(async () => {
    await client`DELETE FROM project_setup_state`;
  });
  it("lets exactly one of two parallel claims win, then reports retryAt", async () => {
    const results = await Promise.all([claimAiRun(orgA, projSrc), claimAiRun(orgA, projSrc)]);
    expect(results.filter((r) => r.kind === "claimed")).toHaveLength(1);
    const limited = results.find((r) => r.kind === "daily_limit");
    expect(limited && limited.kind === "daily_limit" && limited.retryAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
  it("release restores the previous value and allows a new claim", async () => {
    const old = new Date(Date.now() - 2 * 86_400_000);
    await client`INSERT INTO project_setup_state (id, organization_id, project_id, last_ai_run_at) VALUES (${uuidv7()}, ${orgA}, ${projSrc}, ${old.toISOString()}::timestamptz)`;
    const claim = await claimAiRun(orgA, projSrc);
    if (claim.kind !== "claimed") throw new Error("expected claim");
    expect(claim.previous?.getTime()).toBe(old.getTime());
    await releaseAiRun(orgA, projSrc, claim);
    const [row] = await client`SELECT last_ai_run_at FROM project_setup_state WHERE project_id = ${projSrc}`;
    expect(new Date(row.last_ai_run_at).getTime()).toBe(old.getTime());
    expect((await claimAiRun(orgA, projSrc)).kind).toBe("claimed");
  });
  it("an older scan never replaces a newer stored summary", async () => {
    const result = (finalUrl: string) => ({ finalUrl, reachable: true, pages: [] });
    const stored = async () => (await client`SELECT scan_result FROM project_setup_state WHERE project_id = ${projSrc}`)[0].scan_result.finalUrl;
    await saveScanResult(orgA, projSrc, result("https://b.test/"), 200);
    await saveScanResult(orgA, projSrc, result("https://a.test/"), 100);
    expect(await stored()).toBe("https://b.test/");
    await saveScanResult(orgA, projSrc, result("https://c.test/"), 300);
    expect(await stored()).toBe("https://c.test/");
  });
  it("a claim from another org cannot take the slot", async () => {
    await client`INSERT INTO project_setup_state (id, organization_id, project_id) VALUES (${uuidv7()}, ${orgA}, ${projSrc})`;
    expect((await claimAiRun(orgB, projSrc)).kind).toBe("daily_limit");
  });
});
