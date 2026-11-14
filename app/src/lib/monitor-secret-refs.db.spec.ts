/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));

jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true, isImpersonatedSession: async () => false }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import type { AuthContext } from "@/lib/auth-context";
import { validateMonitorSecretRefs } from "./monitor-secret-refs";

const ctx = (projectId: string) => ({ userId: "u", organizationId: "o", project: { id: projectId }, isCliAuth: false }) as unknown as AuthContext;

const databaseName = `monitor_secret_refs_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const projectA = randomUUID();
const projectB = randomUUID();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  await client.unsafe(`CREATE TABLE project_variables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, key text NOT NULL, is_secret boolean NOT NULL DEFAULT false, type text NOT NULL DEFAULT 'variable')`);
  await client`INSERT INTO project_variables (project_id, key, is_secret, type) VALUES
    (${projectA}, 'OPENAI_KEY', true, 'secret'),
    (${projectA}, 'LEGACY_SECRET', true, 'variable'),
    (${projectA}, 'TYPED_SECRET', false, 'secret'),
    (${projectA}, 'PLAIN_VAR', false, 'variable'),
    (${projectB}, 'OTHER_PROJECT_KEY', true, 'secret')`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

describe("validateMonitorSecretRefs (project-scoped lookup)", () => {
  it("accepts secrets of the monitor's own project, however they are flagged", async () => {
    const config = { aiEndpoint: { model: "m", secretKey: "OPENAI_KEY" }, auth: { type: "bearer", secretKey: "LEGACY_SECRET" } };
    expect(await validateMonitorSecretRefs(ctx(projectA), config)).toEqual({ success: true });
    expect(await validateMonitorSecretRefs(ctx(projectA), { auth: { type: "bearer", secretKey: "TYPED_SECRET" } })).toEqual({ success: true });
  });

  it("refuses a secret that belongs to another project", async () => {
    expect(await validateMonitorSecretRefs(ctx(projectA), { aiEndpoint: { model: "m", secretKey: "OTHER_PROJECT_KEY" } })).toMatchObject({ success: false });
    expect(await validateMonitorSecretRefs(ctx(projectB), { aiEndpoint: { model: "m", secretKey: "OPENAI_KEY" } })).toMatchObject({ success: false });
  });

  it("refuses a plain variable and an unknown name", async () => {
    expect(await validateMonitorSecretRefs(ctx(projectA), { auth: { type: "bearer", secretKey: "PLAIN_VAR" } })).toMatchObject({ success: false });
    expect(await validateMonitorSecretRefs(ctx(projectA), { auth: { type: "bearer", secretKey: "NOPE" } })).toMatchObject({ success: false, details: "Secret NOPE was not found in this project" });
  });

  it("needs no lookup when the config names no secret", async () => {
    expect(await validateMonitorSecretRefs(ctx(projectA), { method: "GET" })).toEqual({ success: true });
    expect(await validateMonitorSecretRefs(ctx(projectA), undefined)).toEqual({ success: true });
  });
});
