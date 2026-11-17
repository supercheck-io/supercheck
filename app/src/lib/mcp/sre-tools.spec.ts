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
const withSreTriageAdmission = jest.fn();
jest.mock("@/lib/sre/investigation-billing", () => ({
  assertCanStartSreInvestigation: (...a: unknown[]) => assertCanStartSreInvestigation(...a),
  withSreTriageAdmission: (...a: unknown[]) => withSreTriageAdmission(...a),
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
const mockWindows = { createMaintenanceWindow: jest.fn(), endMaintenanceWindow: jest.fn(), extendMaintenanceWindow: jest.fn(), cancelMaintenanceWindow: jest.fn(), updateMaintenanceWindow: jest.fn(), deleteMaintenanceWindow: jest.fn(), getMaintenanceWindow: jest.fn() };
jest.mock("@/lib/maintenance/windows", () => new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockWindows as Record<string, jest.Mock>)[k]?.(...a) }));
const createManualIncident = jest.fn();
const updateIncidentResources = jest.fn();
jest.mock("@/lib/sre/manual-incident", () => ({ createManualIncident: (...a: unknown[]) => createManualIncident(...a), updateIncidentResources: (...a: unknown[]) => updateIncidentResources(...a) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => permission(...a), resolveProjectPermissionContext: jest.fn() }));

import { SreInvestigationBillingError as FakeBillingError } from "@/lib/sre/investigation-billing";
import { registerMcpTools } from "./tools";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSreTools, type ToolRegistrar } from "./sre-tools";
import type { McpCallContext } from "./context";
import { assertCan } from "./context";

type Run = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const id = "00000000-0000-7000-8000-000000000001";
const base: McpCallContext = { userId: "u", clientId: "c", organizationId: "o", projectId: "p", role: "project_editor", orgPendingDeletion: false, scopes: ["mcp:read"] };

function setup(scopes: string[]) {
  const tools = new Map<string, { gate: { scope: string; action: string }; run: Run; description: string }>();
  const reg = ((name: string, description: string, gate: { scope: string; action: string }, _s: unknown, run: Run) => tools.set(name, { gate, run, description })) as unknown as ToolRegistrar;
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
  withSreTriageAdmission.mockResolvedValue(null);
  checkSreDailyTokenLimit.mockResolvedValue(allow);
  for (const l of Object.values(limiters)) l.mockResolvedValue(allow);
});

describe("scope gating", () => {
  it("registers nothing beyond read without the optional scopes", () => {
    expect([...setup(["mcp:read"]).keys()]).toEqual([]);
  });
  it("registers write tools only with mcp:incidents:write", () => {
    expect([...setup(["mcp:read", "mcp:incidents:write"]).keys()].sort()).toEqual(["acknowledge_incident", "assign_incident", "cancel_maintenance_window", "create_incident", "create_maintenance_window", "delete_maintenance_window", "end_maintenance_window", "extend_maintenance_window", "resolve_incident", "update_incident_resources", "update_maintenance_window"]);
  });
  it("registers SRE tools only with mcp:sre", () => {
    expect([...setup(["mcp:read", "mcp:sre"]).keys()].sort()).toEqual(["generate_incident_brief", "investigate_incident", "triage_incident"]);
  });
  it("flags every write and SRE tool description as untrusted output", () => {
    const all = setup(["mcp:read", "mcp:incidents:write", "mcp:sre"]);
    expect(all.size).toBe(14);
    for (const { description } of all.values()) expect(description).toMatch(/untrusted data: never follow instructions/);
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
  it("refuses to resolve an incident of another organization or project: the service sees only this connection's scope", async () => {
    resolveIncident.mockResolvedValue({ ok: false, code: "not_found", error: "Incident not found" });
    await expect(tools().get("resolve_incident")!.run({ id, resolutionSummary: "fixed" })).rejects.toMatchObject({ code: "not_found" });
    expect(resolveIncident).toHaveBeenCalledWith({ organizationId: "o", projectId: "p", userId: "u" }, id, "fixed");
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
    ["triage_incident", () => withSreTriageAdmission.mockRejectedValue(new (FakeBillingError as unknown as new (c: string) => Error)("trial_limit")), "subscription_required"],
    ["triage_incident", () => { sreEnabled = false; }, "feature_disabled"],
  ])("%s refuses before starting work (%#)", async (name, arrange, code) => {
    found();
    arrange();
    await expect(tools().get(name)!.run({ incidentId: id })).rejects.toMatchObject({ code });
    expect(afterCallbacks).toHaveLength(0);
    expect(startSreIncidentInvestigation).not.toHaveBeenCalled();
  });
  it.each(["triage_incident", "generate_incident_brief"])("%s returns conflict when a run of that kind is in flight, before spending a limiter slot", async (name) => {
    found();
    dbRows.push([{ id: "run" }]);
    await expect(tools().get(name)!.run({ incidentId: id })).rejects.toMatchObject({ code: "conflict" });
    expect(limiters.triage).not.toHaveBeenCalled();
    expect(limiters.brief).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
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

describe("write tools through registerMcpTools (the gate the server really uses)", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent: Record<string, unknown> }>;
  function server(scopes: string[]) {
    const handlers = new Map<string, Handler>();
    registerMcpTools({ registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer, { ...base, scopes });
    return handlers;
  }
  const calls: [string, Record<string, unknown>][] = [
    ["create_incident", { title: "Checkout down" }],
    ["assign_incident", { id, assigneeUserId: null }],
    ["acknowledge_incident", { id }],
    ["resolve_incident", { id, resolutionSummary: "done" }],
    ["update_incident_resources", { id, addServiceIds: [], addMonitorIds: [id], removeServiceIds: [], removeMonitorIds: [] }],
    ["update_maintenance_window", { id, title: "Renamed" }],
    ["delete_maintenance_window", { id }],
  ];
  const services = () => [assignIncident, acknowledgeIncident, resolveIncident, createManualIncident, updateIncidentResources, mockWindows.updateMaintenanceWindow, mockWindows.deleteMaintenanceWindow];
  it.each(calls)("%s is refused for a role without update permission and never reaches the service", async (name, args) => {
    permission.mockReturnValue(false);
    const res = await server(["mcp:read", "mcp:incidents:write"]).get(name)!(args);
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "forbidden" } });
    for (const fn of services()) expect(fn).not.toHaveBeenCalled();
  });
  it.each(calls)("%s answers org_pending_deletion for an organization pending deletion and never reaches the service", async (name, args) => {
    permission.mockReturnValue(true);
    const handlers = new Map<string, Handler>();
    registerMcpTools({ registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer, { ...base, orgPendingDeletion: true, scopes: ["mcp:read", "mcp:incidents:write"] });
    const res = await handlers.get(name)!(args);
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "org_pending_deletion" } });
    for (const fn of services()) expect(fn).not.toHaveBeenCalled();
  });
  it.each(calls)("%s does not exist without the write scope", (name) => {
    expect(server(["mcp:read"]).has(name)).toBe(false);
  });
  it.each(calls)("%s is refused if the scope is dropped after registration", async (name, args) => {
    const scopes = ["mcp:read", "mcp:incidents:write"];
    const handlers = new Map<string, Handler>();
    const ctx = { ...base, scopes };
    registerMcpTools({ registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer, ctx);
    scopes.pop();
    const res = await handlers.get(name)!(args);
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "forbidden" } });
    for (const fn of services()) expect(fn).not.toHaveBeenCalled();
  });
});

describe("create_incident", () => {
  const tools = () => setup(["mcp:read", "mcp:incidents:write"]);
  it("is gated on sre_incident:create and calls the shared core with the live role and source mcp", async () => {
    const tool = tools().get("create_incident")!;
    expect(tool.gate).toMatchObject({ scope: "mcp:incidents:write", action: "create" });
    createManualIncident.mockResolvedValue({ ok: true, incident: { id, incidentNumber: 9, title: "Checkout down" }, warning: "status_page_failed" });
    await expect(tool.run({ title: "Checkout down", severity: "sev2", affectedServiceIds: [], affectedMonitorIds: [id] })).resolves.toEqual({ id, incidentNumber: 9, warning: "status_page_failed" });
    expect(createManualIncident).toHaveBeenCalledWith(
      { userId: "u", organizationId: "o", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } },
      { title: "Checkout down", severity: "sev2", affected: { serviceIds: [], monitorIds: [id] }, statusPage: null },
      "mcp",
    );
  });
  it.each(["rate_limited", "not_found", "invalid", "forbidden", "subscription_required"])("passes a %s core result through as a tool failure", async (code) => {
    createManualIncident.mockResolvedValue({ ok: false, code, error: "nope" });
    await expect(tools().get("create_incident")!.run({ title: "t", affectedServiceIds: [], affectedMonitorIds: [] })).rejects.toMatchObject({ code });
  });
});

describe("maintenance window tools", () => {
  const tools = () => setup(["mcp:read", "mcp:incidents:write"]);
  const view = { ok: true, window: { id, state: "scheduled", occurrenceStartsAt: new Date("2026-11-20T01:00:00Z"), occurrenceEndsAt: new Date("2026-11-20T02:30:00Z") } };
  it("are gated on monitor:update with mcp:incidents:write", () => {
    for (const name of ["create_maintenance_window", "end_maintenance_window", "extend_maintenance_window", "cancel_maintenance_window"]) {
      expect(tools().get(name)!.gate).toMatchObject({ resource: "monitor", action: "update", scope: "mcp:incidents:write" });
    }
  });
  it("create never posts to a status page and passes the live role with source mcp", async () => {
    mockWindows.createMaintenanceWindow.mockResolvedValue(view);
    const out = await tools().get("create_maintenance_window")!.run({ title: "Deploy", scope: "monitors", serviceIds: [], monitorIds: [id], recurrence: "once", timezone: "UTC", startsOn: "2026-11-20", localStartTime: "01:00", durationMinutes: 90 });
    expect(mockWindows.createMaintenanceWindow).toHaveBeenCalledWith(
      { userId: "u", organizationId: "o", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } },
      expect.objectContaining({ targets: { serviceIds: [], monitorIds: [id] }, statusPages: [] }),
      "mcp",
    );
    expect(out).toEqual({ id, state: "scheduled", occurrenceStartsAt: "2026-11-20T01:00:00.000Z", occurrenceEndsAt: "2026-11-20T02:30:00.000Z" });
  });
  it("create and extend surface subscription_required for a lapsed organization; end and cancel have no such gate", async () => {
    const lapsed = { ok: false, code: "subscription_required", error: "Active subscription required." };
    mockWindows.createMaintenanceWindow.mockResolvedValue(lapsed);
    await expect(tools().get("create_maintenance_window")!.run({ title: "Deploy", scope: "project", serviceIds: [], monitorIds: [], recurrence: "once", timezone: "UTC", startsOn: "2026-11-20", localStartTime: "01:00", durationMinutes: 90 })).rejects.toMatchObject({ code: "subscription_required", message: "Active subscription required." });
    mockWindows.extendMaintenanceWindow.mockResolvedValue(lapsed);
    await expect(tools().get("extend_maintenance_window")!.run({ id, byMinutes: 30 })).rejects.toMatchObject({ code: "subscription_required" });
  });
  it("end refuses a window of another organization or project: the core sees only this connection's scope", async () => {
    mockWindows.endMaintenanceWindow.mockResolvedValue({ ok: false, code: "not_found", error: "Maintenance window not found" });
    await expect(tools().get("end_maintenance_window")!.run({ id })).rejects.toMatchObject({ code: "not_found" });
    expect(mockWindows.endMaintenanceWindow).toHaveBeenCalledWith({ userId: "u", organizationId: "o", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } }, id, "mcp");
  });
  it("end, extend and cancel call the core and surface its failures", async () => {
    mockWindows.endMaintenanceWindow.mockResolvedValue(view);
    await tools().get("end_maintenance_window")!.run({ id });
    expect(mockWindows.endMaintenanceWindow).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "o" }), id, "mcp");
    mockWindows.extendMaintenanceWindow.mockResolvedValue({ ok: false, code: "conflict", error: "Only an active window can be extended" });
    await expect(tools().get("extend_maintenance_window")!.run({ id, byMinutes: 30 })).rejects.toMatchObject({ code: "conflict" });
    mockWindows.cancelMaintenanceWindow.mockResolvedValue({ ok: false, code: "not_found", error: "Maintenance window not found" });
    await expect(tools().get("cancel_maintenance_window")!.run({ id })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("maintenance window get, update and delete", () => {
  const actor = { userId: "u", organizationId: "o", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } };
  const tools = () => setup(["mcp:read", "mcp:incidents:write"]);
  const row = {
    id, title: "Deploy", description: "db migration", state: "scheduled", scope: "project", recurrence: "once", timezone: "UTC", startsOn: "2026-11-20", endsOn: null,
    localStartTime: "01:00", durationMinutes: 90, weekdays: null, monthDay: null, occurrenceStartsAt: new Date("2026-11-20T01:00:00Z"), occurrenceEndsAt: new Date("2026-11-20T02:30:00Z"),
    targets: [], statusPageIncidentIds: ["00000000-0000-7000-8000-000000000009"], organizationId: "o", projectId: "p",
  };
  type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; structuredContent: Record<string, unknown> }>;
  function readTools(ctx: Partial<McpCallContext> = {}) {
    const handlers = new Map<string, Handler>();
    registerMcpTools({ registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer, { ...base, ...ctx });
    return handlers;
  }

  it("marks only delete_maintenance_window as destructive", () => {
    const annotations = new Map<string, { destructiveHint: boolean }>();
    registerMcpTools({ registerTool: (n: string, c: { annotations: { destructiveHint: boolean } }) => annotations.set(n, c.annotations) } as unknown as McpServer, { ...base, scopes: ["mcp:read", "mcp:incidents:write"] });
    expect(annotations.get("delete_maintenance_window")!.destructiveHint).toBe(true);
    for (const name of ["update_maintenance_window", "update_incident_resources", "create_incident"]) expect(annotations.get(name)!.destructiveHint).toBe(false);
  });
  it("update is gated on monitor:update and delete on monitor:delete, both with mcp:incidents:write", () => {
    expect(tools().get("update_maintenance_window")!.gate).toMatchObject({ resource: "monitor", action: "update", scope: "mcp:incidents:write" });
    expect(tools().get("delete_maintenance_window")!.gate).toMatchObject({ resource: "monitor", action: "delete", scope: "mcp:incidents:write" });
  });
  it("update sends only the given fields, maps target ids, and runs as the connection with source mcp", async () => {
    mockWindows.updateMaintenanceWindow.mockResolvedValue({ ok: true, window: row });
    const out = await tools().get("update_maintenance_window")!.run({ id, title: "Renamed", scope: "monitors", monitorIds: [id] });
    expect(mockWindows.updateMaintenanceWindow).toHaveBeenCalledWith(actor, id, { title: "Renamed", scope: "monitors", targets: { serviceIds: [], monitorIds: [id] } }, "mcp");
    expect(out).toEqual({ id, state: "scheduled", occurrenceStartsAt: "2026-11-20T01:00:00.000Z", occurrenceEndsAt: "2026-11-20T02:30:00.000Z" });
    await tools().get("update_maintenance_window")!.run({ id, durationMinutes: 30 });
    expect(mockWindows.updateMaintenanceWindow).toHaveBeenLastCalledWith(actor, id, { durationMinutes: 30 }, "mcp");
  });
  it.each(["not_found", "conflict", "invalid", "rate_limited"])("update passes a %s core result through (cross-org ids are not_found)", async (code) => {
    mockWindows.updateMaintenanceWindow.mockResolvedValue({ ok: false, code, error: "nope" });
    await expect(tools().get("update_maintenance_window")!.run({ id, title: "x" })).rejects.toMatchObject({ code });
  });
  it("delete removes the window, and is refused with conflict while it is on a status page", async () => {
    mockWindows.deleteMaintenanceWindow.mockResolvedValueOnce({ ok: true });
    await expect(tools().get("delete_maintenance_window")!.run({ id })).resolves.toEqual({ id, deleted: true });
    expect(mockWindows.deleteMaintenanceWindow).toHaveBeenCalledWith(actor, id, "mcp");
    mockWindows.deleteMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "conflict", error: "This window is on a status page. Cancel it first." });
    await expect(tools().get("delete_maintenance_window")!.run({ id })).rejects.toMatchObject({ code: "conflict" });
    mockWindows.deleteMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "not_found", error: "Maintenance window not found" });
    await expect(tools().get("delete_maintenance_window")!.run({ id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("delete is refused for a role without monitor:delete", async () => {
    permission.mockImplementation((_r: string, action: string) => action !== "delete");
    const res = await readTools({ scopes: ["mcp:read", "mcp:incidents:write"] }).get("delete_maintenance_window")!({ id });
    expect(res).toMatchObject({ isError: true, structuredContent: { code: "forbidden" } });
    expect(mockWindows.deleteMaintenanceWindow).not.toHaveBeenCalled();
  });
  it("get_maintenance_window is a read tool: returns the schedule and onStatusPage, never raw status page ids", async () => {
    mockWindows.getMaintenanceWindow.mockResolvedValue({ ok: true, window: row });
    dbRows.push([{ id: "00000000-0000-7000-8000-000000000009" }]);
    const handlers = readTools();
    const res = await handlers.get("get_maintenance_window")!({ id });
    expect(mockWindows.getMaintenanceWindow).toHaveBeenCalledWith(actor, id);
    expect(res.structuredContent.window).toEqual({
      id, title: "Deploy", description: "db migration", state: "scheduled", scope: "project", recurrence: "once", timezone: "UTC", startsOn: "2026-11-20", endsOn: null,
      localStartTime: "01:00", durationMinutes: 90, weekdays: null, monthDay: null, occurrenceStartsAt: "2026-11-20T01:00:00.000Z", occurrenceEndsAt: "2026-11-20T02:30:00.000Z",
      targets: [], onStatusPage: true,
    });
  });
  it("get_maintenance_window reports onStatusPage false once every post is resolved", async () => {
    mockWindows.getMaintenanceWindow.mockResolvedValue({ ok: true, window: row });
    dbRows.push([]);
    const res = await readTools().get("get_maintenance_window")!({ id });
    expect((res.structuredContent.window as { onStatusPage: boolean }).onStatusPage).toBe(false);
  });
  it("get_maintenance_window answers not_found for another project's window and forbidden without monitor view", async () => {
    mockWindows.getMaintenanceWindow.mockResolvedValue({ ok: false, code: "not_found", error: "Maintenance window not found" });
    expect(await readTools().get("get_maintenance_window")!({ id })).toMatchObject({ isError: true, structuredContent: { code: "not_found" } });
    permission.mockReturnValue(false);
    expect(await readTools().get("get_maintenance_window")!({ id })).toMatchObject({ isError: true, structuredContent: { code: "forbidden" } });
  });
  it("get_maintenance_window still works for an organization pending deletion", async () => {
    mockWindows.getMaintenanceWindow.mockResolvedValue({ ok: true, window: row });
    const res = await readTools({ orgPendingDeletion: true }).get("get_maintenance_window")!({ id });
    expect(res.isError).toBeUndefined();
  });
});

describe("update_incident_resources", () => {
  const tools = () => setup(["mcp:read", "mcp:incidents:write"]);
  it("is gated like the other incident writes and calls the shared core as the connection", async () => {
    const tool = tools().get("update_incident_resources")!;
    expect(tool.gate).toMatchObject({ resource: "sre_incident", action: "update", scope: "mcp:incidents:write" });
    updateIncidentResources.mockResolvedValue({ ok: true, added: 1, removed: 2 });
    await expect(tool.run({ id, addServiceIds: [], addMonitorIds: [id], removeServiceIds: [id], removeMonitorIds: [] })).resolves.toEqual({ id, added: 1, removed: 2 });
    expect(updateIncidentResources).toHaveBeenCalledWith(
      { userId: "u", organizationId: "o", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } },
      id,
      { add: { serviceIds: [], monitorIds: [id] }, remove: { serviceIds: [id], monitorIds: [] } },
    );
  });
  it("stops at the incident update rate limit before touching the incident", async () => {
    limiters.update.mockResolvedValue({ allowed: false });
    await expect(tools().get("update_incident_resources")!.run({ id, addServiceIds: [], addMonitorIds: [], removeServiceIds: [], removeMonitorIds: [] })).rejects.toMatchObject({ code: "rate_limited" });
    expect(updateIncidentResources).not.toHaveBeenCalled();
  });
  it.each(["not_found", "conflict", "invalid", "forbidden"])("passes a %s core result through (foreign or resolved incidents)", async (code) => {
    updateIncidentResources.mockResolvedValue({ ok: false, code, error: "nope" });
    await expect(tools().get("update_incident_resources")!.run({ id, addServiceIds: [], addMonitorIds: [], removeServiceIds: [], removeMonitorIds: [] })).rejects.toMatchObject({ code });
  });
});

describe("get_context", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ structuredContent: Record<string, unknown> }>;
  it.each([false, true])("reports the organization's pending deletion state (%s)", async (pending) => {
    const handlers = new Map<string, Handler>();
    registerMcpTools({ registerTool: (n: string, _c: unknown, h: Handler) => handlers.set(n, h) } as unknown as McpServer, { ...base, orgPendingDeletion: pending });
    dbRows.push([{ id: "p", name: "Checkout" }]);
    const res = await handlers.get("get_context")!({});
    expect(res.structuredContent).toEqual({ project: { id: "p", name: "Checkout" }, role: "project_editor", scopes: ["mcp:read"], organization: { pendingDeletion: pending } });
  });
});

describe("incident and window ids", () => {
  it("are lowercased so a differently cased id shares the rate-limit bucket", () => {
    const shapes = new Map<string, Record<string, import("zod").ZodTypeAny>>();
    registerSreTools(((name: string, _d: string, _g: unknown, shape: Record<string, import("zod").ZodTypeAny>) => shapes.set(name, shape)) as unknown as ToolRegistrar, { ...base, scopes: ["mcp:read", "mcp:incidents:write"] });
    const upper = "0000000A-0000-7000-8000-00000000000B";
    for (const name of ["update_incident_resources", "acknowledge_incident", "delete_maintenance_window"]) {
      expect(shapes.get(name)!.id.parse(upper)).toBe(upper.toLowerCase());
    }
  });
});
