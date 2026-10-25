/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: {} }));
const requireAuthContext = jest.fn();
class FakeAuthError extends Error {}
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => requireAuthContext(...a),
  isAuthError: (e: unknown) => e instanceof FakeAuthError,
}));
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
}));
jest.mock("@/lib/asset-proxy", () => ({ generateProxyUrl: (v: string | null) => v }));
const updateComponent = jest.fn();
const deleteComponent = jest.fn();
jest.mock("@/lib/status-pages/service", () => {
  const actual = jest.requireActual("@/lib/status-pages/service");
  return {
    ...actual,
    updateComponent: (...a: unknown[]) => updateComponent(...a),
    deleteComponent: (...a: unknown[]) => deleteComponent(...a),
  };
});

import { NextRequest } from "next/server";
import { DELETE, PUT } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const componentId = "00000000-0000-4000-8000-000000000002";
const authCtx = { userId: "u1", organizationId: "o1", project: { id: "p1", name: "P" } };
const params = (cid = componentId) => ({ params: Promise.resolve({ id, componentId: cid }) });
const put = (body: unknown, cid = componentId) =>
  PUT(new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }), params(cid));
const del = (cid = componentId) => DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), params(cid));
const componentRow = { id: componentId, name: "API", description: null, position: 1, status: "operational", showcase: true, onlyShowIfDegraded: false, aggregationMethod: "worst_case", failureThreshold: 1, autoCreateIncidents: false, serviceId: null };

describe("status page component item route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue(authCtx);
    checkPermissionWithContext.mockReturnValue(true);
  });

  it("401 on both methods", async () => {
    requireAuthContext.mockRejectedValue(new FakeAuthError("Authentication required"));
    expect((await put({ name: "A" })).status).toBe(401);
    expect((await del()).status).toBe(401);
  });

  it("403 for a viewer on both methods", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect((await put({ name: "A" })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("status_page", "delete", authCtx);
    expect(updateComponent).not.toHaveBeenCalled();
    expect(deleteComponent).not.toHaveBeenCalled();
  });

  it("400 for bad ids and bodies", async () => {
    expect((await put({ name: "A" }, "bad")).status).toBe(400);
    expect((await del("bad")).status).toBe(400);
    expect((await put({ name: "" })).status).toBe(400);
    expect((await put({ position: 1.5 })).status).toBe(400);
    expect((await put({ id: componentId })).status).toBe(400);
  });

  it("404 for a component or page in another project", async () => {
    updateComponent.mockResolvedValue({ ok: false, code: "not_found", message: "Component not found or access denied" });
    deleteComponent.mockResolvedValue({ ok: false, code: "not_found", message: "Component not found or access denied" });
    expect((await put({ name: "A" })).status).toBe(404);
    expect((await del()).status).toBe(404);
  });

  it("400 when monitorIds belong to another project", async () => {
    updateComponent.mockResolvedValue({ ok: false, code: "validation", message: "One or more monitors not found or access denied" });
    expect((await put({ monitorIds: ["00000000-0000-4000-8000-0000000000a1"] })).status).toBe(400);
  });

  it("PUT 200 returns the component", async () => {
    updateComponent.mockResolvedValue({ ok: true, data: { component: componentRow, monitorIds: [] } });
    const res = await put({ name: "API", position: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).component).toMatchObject({ id: componentId, position: 1, monitorIds: [] });
    expect(updateComponent).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), id, componentId, { name: "API", position: 1 });
  });

  it("DELETE 200 returns success", async () => {
    deleteComponent.mockResolvedValue({ ok: true, data: null });
    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
