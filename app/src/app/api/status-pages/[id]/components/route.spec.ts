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
const listComponents = jest.fn();
const createComponent = jest.fn();
jest.mock("@/lib/status-pages/service", () => {
  const actual = jest.requireActual("@/lib/status-pages/service");
  return {
    ...actual,
    listComponents: (...a: unknown[]) => listComponents(...a),
    createComponent: (...a: unknown[]) => createComponent(...a),
  };
});

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const monitorId = "00000000-0000-4000-8000-0000000000a1";
const authCtx = { userId: "u1", organizationId: "o1", project: { id: "p1", name: "P" } };
const params = (pageId = id) => ({ params: Promise.resolve({ id: pageId }) });
const post = (body: unknown, pageId = id) =>
  POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), params(pageId));
const get = (pageId = id) => GET(new NextRequest("http://localhost/x"), params(pageId));
const componentRow = { id: "c1", name: "API", description: null, position: 0, status: "operational", showcase: true, onlyShowIfDegraded: false, aggregationMethod: "worst_case", failureThreshold: 1, autoCreateIncidents: false, serviceId: null };

describe("status page components collection route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue(authCtx);
    checkPermissionWithContext.mockReturnValue(true);
  });

  it("GET 401 / 403 / 404 / 200", async () => {
    requireAuthContext.mockRejectedValueOnce(new FakeAuthError("Authentication required"));
    expect((await get()).status).toBe(401);
    checkPermissionWithContext.mockReturnValueOnce(false);
    expect((await get()).status).toBe(403);
    listComponents.mockResolvedValueOnce({ ok: false, code: "not_found", message: "Status page not found or access denied" });
    expect((await get()).status).toBe(404);
    listComponents.mockResolvedValueOnce({ ok: true, data: { components: [{ id: "c1", monitorIds: [] }] } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ components: [{ id: "c1", monitorIds: [] }] });
  });

  it("POST 401", async () => {
    requireAuthContext.mockRejectedValue(new FakeAuthError("Authentication required"));
    expect((await post({ name: "A" })).status).toBe(401);
  });

  it("POST 403 for a viewer", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect((await post({ name: "A" })).status).toBe(403);
    expect(createComponent).not.toHaveBeenCalled();
  });

  it("POST 400 for invalid bodies", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ name: "A", monitorIds: ["nope"] })).status).toBe(400);
    expect((await post({ name: "A", position: -1 })).status).toBe(400);
    expect((await post({ name: "A", statusPageId: id })).status).toBe(400);
    expect((await post({ name: "A" }, "bad-id")).status).toBe(400);
  });

  it("POST 404 for a page in another project", async () => {
    createComponent.mockResolvedValue({ ok: false, code: "not_found", message: "Status page not found or access denied" });
    expect((await post({ name: "A" })).status).toBe(404);
  });

  it("POST 400 when monitors belong to another project", async () => {
    createComponent.mockResolvedValue({ ok: false, code: "validation", message: "One or more monitors not found or access denied" });
    const res = await post({ name: "A", monitorIds: [monitorId] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("One or more monitors not found or access denied");
  });

  it("POST 201 returns the component DTO", async () => {
    createComponent.mockResolvedValue({ ok: true, data: { component: componentRow, monitorIds: [monitorId] } });
    const res = await post({ name: "API", monitorIds: [monitorId], position: 2 });
    expect(res.status).toBe(201);
    expect((await res.json()).component).toMatchObject({ id: "c1", name: "API", monitorIds: [monitorId] });
    expect(createComponent).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1" }), id, { name: "API", monitorIds: [monitorId], position: 2 });
  });
});
