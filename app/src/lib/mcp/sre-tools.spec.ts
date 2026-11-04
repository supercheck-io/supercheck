/** @jest-environment node */
const dbRows: unknown[][] = [];
jest.mock("@/utils/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(dbRows.shift() ?? []).then(res);
  return { db: chain };
});
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const afterCallbacks: (() => unknown)[] = [];
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
const requireSreSubscription = jest.fn();
jest.mock("@/app/api/sre/_auth", () => ({ requireSreSubscription: (...a: unknown[]) => requireSreSubscription(...a) }));
const assertCanStartSreInvestigation = jest.fn();
jest.mock("@/lib/sre/investigation-billing", () => ({
  assertCanStartSreInvestigation: (...a: unknown[]) => assertCanStartSreInvestigation(...a),
  SreInvestigationBillingError: class extends Error { constructor(readonly code: string) { super(code); } },
}));
jest.mock("@/lib/sre/billing-error-messages", () => ({ sreBillingErrorMessage: (c: string) => `billing:${c}` }));
const checkSreDailyTokenLimit = jest.fn();
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ checkSreDailyTokenLimit: (...a: unknown[]) => checkSreDailyTokenLimit(...a) }));
const allow = { allowed: true };
const limiters = { triage: jest.fn(), brief: jest.fn(), investigate: jest.fn(), update: jest.fn() };
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreTriageRateLimit: (...a: unknown[]) => limiters.triage(...a),
  checkSreEvidenceBriefRateLimit: (...a: unknown[]) => limiters.brief(...a),
  checkSreInvestigationRateLimit: (...a: unknown[]) => limiters.investigate(...a),
  checkSreIncidentUpdateRateLimit: (...a: unknown[]) => limiters.update(...a),
}));
const assignIncident = jest.fn();
const acknowledgeIncident = jest.fn();
const resolveIncident = jest.fn();
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  MAX_RESOLUTION_SUMMARY_LENGTH: 2000,
  assignIncident: (...a: unknown[]) => assignIncident(...a),
  acknowledgeIncident: (...a: unknown[]) => acknowledgeIncident(...a),
  resolveIncident: (...a: unknown[]) => resolveIncident(...a),
}));
jest.mock("@/lib/sre/feedback-note", () => ({ investigationGuidanceSchema: jest.requireActual("zod").z.string().max(200) }));
jest.mock("@/lib/sre/evidence-brief-generator", () => ({ generateEvidenceBrief: jest.fn() }));
const runSreEvidenceBriefGeneration = jest.fn();
jest.mock("@/lib/sre/evidence-brief-orchestrator", () => ({ runSreEvidenceBriefGeneration: (...a: unknown[]) => runSreEvidenceBriefGeneration(...a) }));
let sreEnabled = true;
jest.mock("@/sre/lib/feature-gates", () => ({ isSreEnabled: () => sreEnabled }));
const startSreIncidentInvestigation = jest.fn();
const completeSreIncidentInvestigation = jest.fn();
jest.mock("@/sre/lib/investigation-runner", () => ({
  startSreIncidentInvestigation: (...a: unknown[]) => startSreIncidentInvestigation(...a),
  completeSreIncidentInvestigation: (...a: unknown[]) => completeSreIncidentInvestigation(...a),
}));
const runSreIncidentTriage = jest.fn();
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: (...a: unknown[]) => runSreIncidentTriage(...a) }));
const permission = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => permission(...a), resolveProjectPermissionContext: jest.fn() }));

import { SreInvestigationBillingError as FakeBillingError } from "@/lib/sre/investigation-billing";
import { registerSreTools, type ToolRegistrar } from "./sre-tools";
import type { McpCallContext } from "./context";
import { assertCan } from "./context";

type Run = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const id = "00000000-0000-7000-8000-000000000001";
const base: McpCallContext = { userId: "u", clientId: "c", organizationId: "o", projectId: "p", role: "project_editor", scopes: ["mcp:read"] };

function setup(scopes: string[]) {
  const tools = new Map<string, { gate: { scope: string; action: string }; run: Run }>();
  const reg = ((name: string, _d: string, gate: { scope: string; action: string }, _s: unknown, run: Run) => tools.set(name, { gate, run })) as unknown as ToolRegistrar;
  registerSreTools(reg, { ...base, scopes });
  return tools;
}

beforeEach(() => {
  jest.clearAllMocks();
  dbRows.length = 0;
  afterCallbacks.length = 0;
  sreEnabled = true;
  permission.mockReturnValue(true);
  requireSreSubscription.mockResolvedValue(null);
  assertCanStartSreInvestigation.mockResolvedValue(undefined);
  checkSreDailyTokenLimit.mockResolvedValue(allow);
  for (const l of Object.values(limiters)) l.mockResolvedValue(allow);
});

describe("scope gating", () => {
  it("registers nothing beyond read without the optional scopes", () => {
    expect([...setup(["mcp:read"]).keys()]).toEqual([]);
  });
  it("registers write tools only with mcp:incidents:write", () => {
    expect([...setup(["mcp:read", "mcp:incidents:write"]).keys()].sort()).toEqual(["acknowledge_incident", "assign_incident", "resolve_incident"]);
  });
  it("registers SRE tools only with mcp:sre", () => {
    expect([...setup(["mcp:read", "mcp:sre"]).keys()].sort()).toEqual(["generate_incident_brief", "investigate_incident", "triage_incident"]);
  });
  it("assertCan refuses a missing scope even when the role would allow it", () => {
    expect(() => assertCan(base, "sre_incident", "update", "mcp:incidents:write")).toThrow("missing_scope");
  });
});

describe("incident write tools", () => {
  const tools = () => setup(["mcp:read", "mcp:incidents:write"]);
  it("resolves through the lifecycle service as the connected user", async () => {
    resolveIncident.mockResolvedValue({ ok: true, incident: { id, incidentNumber: 7 }, changed: true });
    const out = await tools().get("resolve_incident")!.run({ id, resolutionSummary: "fixed" });
    expect(resolveIncident).toHaveBeenCalledWith({ organizationId: "o", projectId: "p", userId: "u" }, id, "fixed");
    expect(out).toEqual({ incidentNumber: 7, changed: true });
  });
  it("surfaces service refusals as typed failures", async () => {
    acknowledgeIncident.mockResolvedValue({ ok: false, code: "not_found", error: "Incident not found" });
    await expect(tools().get("acknowledge_incident")!.run({ id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("stops at the rate limit before touching the incident", async () => {
    limiters.update.mockResolvedValue({ allowed: false });
    await expect(tools().get("assign_incident")!.run({ id, assigneeUserId: null, role: "assignee" })).rejects.toMatchObject({ code: "rate_limited" });
    expect(assignIncident).not.toHaveBeenCalled();
  });
});

describe("AI SRE tools", () => {
  const tools = () => setup(["mcp:read", "mcp:sre"]);
  const found = () => dbRows.push([{ id }]);

  it("triage runs detached after every gate passes", async () => {
    found();
    runSreIncidentTriage.mockResolvedValue({ success: true });
    const out = await tools().get("triage_incident")!.run({ incidentId: id });
    expect(out).toMatchObject({ accepted: true, incidentId: id });
    expect(runSreIncidentTriage).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(runSreIncidentTriage).toHaveBeenCalledWith({ organizationId: "o", projectId: "p", userId: "u", incidentId: id });
  });
  it.each([
    ["triage_incident", () => requireSreSubscription.mockResolvedValue({ json: async () => ({ error: "Subscribe" }) }), "subscription_required"],
    ["triage_incident", () => requireSreSubscription.mockResolvedValue({ status: 503, json: async () => ({ error: "Try again" }) }), "unavailable"],
    ["triage_incident", () => limiters.triage.mockResolvedValue({ allowed: false }), "rate_limited"],
    ["generate_incident_brief", () => limiters.brief.mockResolvedValue({ allowed: false, unavailable: true }), "rate_limited"],
    ["investigate_incident", () => checkSreDailyTokenLimit.mockResolvedValue({ allowed: false }), "daily_limit"],
    ["investigate_incident", () => assertCanStartSreInvestigation.mockRejectedValue(new (FakeBillingError as unknown as new (c: string) => Error)("no_credits")), "subscription_required"],
    ["triage_incident", () => { sreEnabled = false; }, "feature_disabled"],
  ])("%s refuses before starting work (%#)", async (name, arrange, code) => {
    found();
    arrange();
    await expect(tools().get(name)!.run({ incidentId: id })).rejects.toMatchObject({ code });
    expect(afterCallbacks).toHaveLength(0);
    expect(startSreIncidentInvestigation).not.toHaveBeenCalled();
  });
  it("briefs need a plan, not a trial", async () => {
    found();
    await tools().get("generate_incident_brief")!.run({ incidentId: id });
    expect(requireSreSubscription).toHaveBeenCalledWith("o", { allowTrial: false });
  });
  it("refuses an incident outside the project before any paid work", async () => {
    await expect(tools().get("triage_incident")!.run({ incidentId: id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("investigation needs connector permission for live connectors", async () => {
    found();
    permission.mockImplementation((resource: string) => resource !== "sre_connector");
    await expect(tools().get("investigate_incident")!.run({ incidentId: id, useLiveConnectors: true })).rejects.toThrow("forbidden");
    expect(limiters.investigate).not.toHaveBeenCalled();
    expect(startSreIncidentInvestigation).not.toHaveBeenCalled();
  });
  it("investigation returns the run id and completes after the response", async () => {
    found();
    startSreIncidentInvestigation.mockResolvedValue({ success: true, investigationRunId: "run1", incident: { id } });
    completeSreIncidentInvestigation.mockResolvedValue({ success: true });
    const out = await tools().get("investigate_incident")!.run({ incidentId: id, useLiveConnectors: false });
    expect(out).toMatchObject({ accepted: true, investigationRunId: "run1" });
    await afterCallbacks[0]();
    expect(completeSreIncidentInvestigation).toHaveBeenCalledWith("run1", { id }, expect.objectContaining({ incidentId: id, enableLiveConnectors: false }));
  });
  it("a viewer is refused", async () => {
    found();
    permission.mockReturnValue(false);
    await expect(tools().get("triage_incident")!.run({ incidentId: id })).rejects.toThrow("forbidden");
  });
});
