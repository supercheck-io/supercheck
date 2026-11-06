import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const afterCallbacks: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
jest.mock("@/app/api/sre/_auth", () => ({ requireSreSubscription: async () => null }));
jest.mock("@/lib/sre/investigation-billing", () => ({
  assertCanStartSreInvestigation: jest.fn(),
  withSreTriageAdmission: jest.fn((_org: string, createRun: (db: unknown, tier: string) => unknown) => createRun({}, "paid")),
  SreInvestigationBillingError: class extends Error {},
}));
jest.mock("@/lib/sre/billing-error-messages", () => ({ sreBillingErrorMessage: String }));
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ checkSreDailyTokenLimit: async () => ({ allowed: true }) }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreTriageRateLimit: async () => ({ allowed: true }),
  checkSreEvidenceBriefRateLimit: async () => ({ allowed: true }),
  checkSreInvestigationRateLimit: async () => ({ allowed: true }),
  checkSreIncidentUpdateRateLimit: async () => ({ allowed: true }),
}));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ MAX_RESOLUTION_SUMMARY_LENGTH: 2000, assignIncident: jest.fn(), acknowledgeIncident: jest.fn(), resolveIncident: jest.fn() }));
jest.mock("@/lib/sre/feedback-note", () => ({ investigationGuidanceSchema: jest.requireActual("zod").z.string().max(200) }));
jest.mock("@/lib/sre/evidence-brief-generator", () => ({ generateEvidenceBrief: jest.fn() }));
jest.mock("@/lib/sre/evidence-brief-orchestrator", () => ({ runSreEvidenceBriefGeneration: jest.fn() }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreEnabled: () => true }));
jest.mock("@/sre/lib/investigation-runner", () => ({ startSreIncidentInvestigation: jest.fn(), completeSreIncidentInvestigation: jest.fn() }));
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true, resolveProjectPermissionContext: jest.fn() }));

import { registerSreTools, type ToolRegistrar } from "./sre-tools";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";

const name = `mcp_sre_${randomUUID().replaceAll("-", "")}`;
const org = randomUUID(), otherOrg = randomUUID(), project = randomUUID(), otherProject = randomUUID();
const own = randomUUID(), foreignOrg = randomUUID(), foreignProject = randomUUID();
let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  admin = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = `/${name}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client, { schema });
  // Only the columns the start gate reads.
  await client.unsafe(`CREATE TABLE sre_incidents (id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL)`);
  await client.unsafe(`CREATE TABLE sre_investigation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, incident_id uuid, agent_type text NOT NULL, status text NOT NULL, started_at timestamptz NOT NULL)`);
  await client`INSERT INTO sre_incidents VALUES (${own}, ${org}, ${project}), (${foreignOrg}, ${otherOrg}, ${project}), (${foreignProject}, ${org}, ${otherProject})`;
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (admin) { await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end({ timeout: 5 }); }
});

function tool(toolName: string) {
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const reg = ((n: string, _d: string, _g: unknown, _s: unknown, run: (a: Record<string, unknown>) => Promise<unknown>) => tools.set(n, run)) as unknown as ToolRegistrar;
  registerSreTools(reg, { userId: "u", clientId: "c", organizationId: org, projectId: project, role: "project_editor", scopes: ["mcp:read", "mcp:sre"] });
  return tools.get(toolName)!;
}

describe("MCP AI SRE start gate against a real database", () => {
  it.each([["another organization", foreignOrg], ["another project", foreignProject], ["no such incident", randomUUID()]])(
    "refuses an incident from %s before any paid work", async (_label, incidentId) => {
      await expect(tool("triage_incident")({ incidentId })).rejects.toMatchObject({ code: "not_found" });
      expect(afterCallbacks).toHaveLength(0);
      expect(runSreIncidentTriage).not.toHaveBeenCalled();
    });
  it("returns conflict while a run of that kind is in flight, but not for a stale or other-kind run", async () => {
    const busy = randomUUID();
    await client`INSERT INTO sre_incidents VALUES (${busy}, ${org}, ${project})`;
    await client`INSERT INTO sre_investigation_runs (organization_id, project_id, incident_id, agent_type, status, started_at) VALUES
      (${org}, ${project}, ${busy}, 'triage', 'running', now()), (${org}, ${project}, ${busy}, 'sre_ai', 'running', now() - interval '10 minutes')`;
    await expect(tool("triage_incident")({ incidentId: busy })).rejects.toMatchObject({ code: "conflict" });
    // The brief run is older than the stale window, so the runner would recover it: not a conflict.
    await expect(tool("generate_incident_brief")({ incidentId: busy })).resolves.toMatchObject({ accepted: true });
    afterCallbacks.length = 0;
  });
  it("accepts an incident of the connected project", async () => {
    await expect(tool("triage_incident")({ incidentId: own })).resolves.toMatchObject({ accepted: true });
    expect(afterCallbacks).toHaveLength(1);
  });
});
