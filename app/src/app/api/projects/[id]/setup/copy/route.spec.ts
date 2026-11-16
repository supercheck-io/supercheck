/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async () => {
    const { NextResponse } = jest.requireActual("next/server");
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: jest.fn(),
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSlidingWindowRateLimit: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/setup/copy", () => ({ copyProviders: jest.fn(), copyConnectors: jest.fn(), listProviderIds: jest.fn(), listConnectorIds: jest.fn() }));

import { POST } from "./route";
import { requireAuth, resolveProjectPermissionContext, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSlidingWindowRateLimit } from "@/lib/sre/sre-rate-limiter";
import { logAuditEvent } from "@/lib/audit-logger";
import { copyConnectors, copyProviders, listConnectorIds, listProviderIds } from "@/lib/setup/copy";

const TARGET = "11111111-1111-4111-8111-111111111111";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const PID = "44444444-4444-4444-8444-444444444444";
const CID = "55555555-5555-4555-8555-555555555555";
const ORG = "22222222-2222-4222-8222-222222222222";
const mk = (id: string, org = ORG) => ({ userId: "u1", organizationId: org, orgPendingDeletion: false, project: { id, userRole: "project_editor" } });
const params = { params: Promise.resolve({ id: TARGET }) };
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/projects/${TARGET}/setup/copy`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const both = { sourceProjectId: SOURCE, providerIds: [PID], connectorIds: [CID] };

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
  (resolveProjectPermissionContext as jest.Mock).mockImplementation(async (_u: string, id: string) => mk(id));
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
  (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (listProviderIds as jest.Mock).mockResolvedValue([PID]);
  (listConnectorIds as jest.Mock).mockResolvedValue([CID]);
  (copyProviders as jest.Mock).mockResolvedValue([{ sourceId: PID, id: "np", status: "copied", name: "Slack", type: "slack" }]);
  (copyConnectors as jest.Mock).mockResolvedValue([
    { sourceId: CID, id: "nc", status: "copied", name: "Prom", type: "prometheus" },
    { sourceId: "x", status: "failed", error: "Connector not found in the source project" },
  ]);
});

describe("guards", () => {
  it("401 anonymous and bearer, 404 bad or unknown target", async () => {
    (requireAuth as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect((await POST(req(both), params)).status).toBe(401);
    expect((await POST(req(both, { authorization: "Bearer t" }), params)).status).toBe(401);
    expect((await POST(req(both), { params: Promise.resolve({ id: "x" }) })).status).toBe(404);
    (resolveProjectPermissionContext as jest.Mock).mockResolvedValueOnce(null);
    expect((await POST(req(both), params)).status).toBe(404);
  });
  it("400 for bad bodies", async () => {
    expect((await POST(req("{no"), params)).status).toBe(400);
    expect((await POST(req({ sourceProjectId: "x" }), params)).status).toBe(400);
    expect((await POST(req({ sourceProjectId: SOURCE, providerIds: Array(11).fill(PID) }), params)).status).toBe(400);
    expect((await POST(req({ sourceProjectId: SOURCE }), params)).status).toBe(400);
    expect((await POST(req({ sourceProjectId: TARGET, providerIds: [PID] }), params)).status).toBe(400);
    expect((await POST(req({ ...both, extra: 1 }), params)).status).toBe(400);
  });
  it("404 when the source is cross-org or not reachable", async () => {
    (resolveProjectPermissionContext as jest.Mock).mockImplementation(async (_u: string, id: string) => mk(id, id === SOURCE ? "other-org" : ORG));
    expect((await POST(req(both), params)).status).toBe(404);
    (resolveProjectPermissionContext as jest.Mock).mockImplementation(async (_u: string, id: string) => (id === SOURCE ? null : mk(id)));
    expect((await POST(req(both), params)).status).toBe(404);
    expect(copyProviders).not.toHaveBeenCalled();
  });
  it("403 for a viewer on the target", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await POST(req(both), params)).status).toBe(403);
  });
  it("403 when the source denies notification:update (cross-project, no permission)", async () => {
    (checkPermissionWithContext as jest.Mock).mockImplementation((r: string, a: string, c: { project: { id: string } }) =>
      !(c.project.id === SOURCE && r === "notification" && a === "update"));
    expect((await POST(req({ sourceProjectId: SOURCE, providerIds: [PID] }), params)).status).toBe(403);
    expect(copyProviders).not.toHaveBeenCalled();
  });
  it("editor is denied connectors but may copy providers", async () => {
    (checkPermissionWithContext as jest.Mock).mockImplementation((r: string) => r !== "sre_connector");
    expect((await POST(req(both), params)).status).toBe(403);
    expect((await POST(req({ sourceProjectId: SOURCE, providerIds: [PID] }), params)).status).toBe(200);
    expect((await POST(req({ sourceProjectId: SOURCE, connectorIds: [CID] }), params)).status).toBe(403);
  });
  it("connector permission denied on the source only", async () => {
    (checkPermissionWithContext as jest.Mock).mockImplementation((r: string, _a: string, c: { project: { id: string } }) => !(r === "sre_connector" && c.project.id === SOURCE));
    expect((await POST(req({ sourceProjectId: SOURCE, connectorIds: [CID] }), params)).status).toBe(403);
  });
  it("pending-deletion shape is the shared 403 body", async () => {
    (resolveProjectPermissionContext as jest.Mock).mockImplementation(async (_u: string, id: string) => ({ ...mk(id), orgPendingDeletion: true }));
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    const res = await POST(req(both), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Insufficient permissions" });
  });
  it("429 per user, 429 per org, 503 when the limiter is down", async () => {
    (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 1000 });
    const res = await POST(req(both), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    (checkSlidingWindowRateLimit as jest.Mock)
      .mockResolvedValueOnce({ allowed: true, remaining: 1 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0 });
    expect((await POST(req(both), params)).status).toBe(429);
    (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, unavailable: true });
    expect((await POST(req(both), params)).status).toBe(503);
    expect(copyProviders).not.toHaveBeenCalled();
  });
});

describe("copy", () => {
  it("copies both kinds, audits each created item and the summary, returns names but no config or plaintext", async () => {
    const res = await POST(req({ ...both, providerIds: [PID, PID] }), params);
    expect(res.status).toBe(200);
    expect(copyProviders).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, sourceProjectId: SOURCE, targetProjectId: TARGET }), [PID]);
    expect(await res.json()).toEqual({
      providers: [{ sourceId: PID, id: "np", status: "copied", name: "Slack", type: "slack" }],
      connectors: [
        { sourceId: CID, id: "nc", status: "copied", name: "Prom", type: "prometheus" },
        { sourceId: "x", status: "failed", error: "Connector not found in the source project" },
      ],
    });
    const actions = (logAuditEvent as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["notification_provider_created", "sre_connector_created", "project_setup.copied"]);
    expect((logAuditEvent as jest.Mock).mock.calls[2][0].metadata).toEqual({ providers: 1, connectors: 1 });
  });
  it("adopted and failed items are not audited as created", async () => {
    (copyProviders as jest.Mock).mockResolvedValue([{ sourceId: PID, id: "np", status: "adopted" }]);
    (copyConnectors as jest.Mock).mockResolvedValue([]);
    await POST(req({ sourceProjectId: SOURCE, providerIds: [PID] }), params);
    expect((logAuditEvent as jest.Mock).mock.calls.map((c) => c[0].action)).toEqual(["project_setup.copied"]);
    expect(copyConnectors).toHaveBeenCalledWith(expect.anything(), []);
  });
  it("all* resolves the source ids server-side and merges them with explicit ids", async () => {
    const res = await POST(req({ sourceProjectId: SOURCE, allProviders: true, allConnectors: true }), params);
    expect(res.status).toBe(200);
    expect(listProviderIds).toHaveBeenCalledWith(expect.objectContaining({ sourceProjectId: SOURCE }));
    expect(copyProviders).toHaveBeenCalledWith(expect.anything(), [PID]);
    expect(copyConnectors).toHaveBeenCalledWith(expect.anything(), [CID]);
  });
  it("all* keeps the permission checks: an editor cannot copy all connectors", async () => {
    (checkPermissionWithContext as jest.Mock).mockImplementation((r: string) => r !== "sre_connector");
    expect((await POST(req({ sourceProjectId: SOURCE, allConnectors: true }), params)).status).toBe(403);
    expect(listConnectorIds).not.toHaveBeenCalled();
  });
  it("all* false and no ids is still Nothing to copy", async () => {
    expect((await POST(req({ sourceProjectId: SOURCE, allProviders: false }), params)).status).toBe(400);
  });
  it("500 on an unexpected error without leaking it", async () => {
    (copyProviders as jest.Mock).mockRejectedValue(new Error("secret-detail"));
    const res = await POST(req(both), params);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail");
  });
});
