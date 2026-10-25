/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/requirements/service", () => {
  return {
    getRequirementDto: jest.fn(),
    linkTestsRecord: jest.fn(),
    unlinkTestsRecord: jest.fn(),
    listLinkedTestsRecord: jest.fn(),
    restTestIdsSchema: jest.requireActual("@/lib/requirements/service").restTestIdsSchema,
    toServiceContext: (c: { userId: string; organizationId: string; project: { id: string; name: string } }) => ({
      userId: c.userId, organizationId: c.organizationId, projectId: c.project.id, projectName: c.project.name,
    }),
  };
});
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getRequirementDto, linkTestsRecord, listLinkedTestsRecord, unlinkTestsRecord } from "@/lib/requirements/service";
import { GET, POST, DELETE } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const T1 = "66666666-6666-4666-8666-666666666666";
const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const params = () => ({ params: Promise.resolve({ id: ID }) });
const req = (method: string, body?: unknown, query = "") =>
  new NextRequest(`http://localhost/api/requirements/${ID}/tests${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
  (getRequirementDto as jest.Mock).mockResolvedValue({ id: ID, testIds: [T1] });
});

describe("GET /api/requirements/[id]/tests", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await GET(req("GET"), params())).status).toBe(401);
  });
  it("404 cross-project requirement", async () => {
    (listLinkedTestsRecord as jest.Mock).mockResolvedValue(null);
    expect((await GET(req("GET"), params())).status).toBe(404);
  });
  it("200 lists linked tests", async () => {
    (listLinkedTestsRecord as jest.Mock).mockResolvedValue([{ id: T1, title: "t", type: "browser" }]);
    const res = await GET(req("GET"), params());
    expect(await res.json()).toEqual({ tests: [{ id: T1, title: "t", type: "browser" }] });
  });
});

describe("POST /api/requirements/[id]/tests", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await POST(req("POST", { testIds: [T1] }), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("requirement", "update", authCtx);
    expect(linkTestsRecord).not.toHaveBeenCalled();
  });
  it("400 on an empty or invalid body", async () => {
    expect((await POST(req("POST", { testIds: [] }), params())).status).toBe(400);
    expect((await POST(req("POST", { testIds: ["x"] }), params())).status).toBe(400);
    expect((await POST(req("POST", { testIds: [T1], extra: 1 }), params())).status).toBe(400);
    expect(linkTestsRecord).not.toHaveBeenCalled();
  });
  it("404 when the requirement or tests are outside the project", async () => {
    (linkTestsRecord as jest.Mock).mockResolvedValue({ success: false, code: "not_found", error: "nf" });
    expect((await POST(req("POST", { testIds: [T1] }), params())).status).toBe(404);
  });
  it("200 links and returns the requirement", async () => {
    (linkTestsRecord as jest.Mock).mockResolvedValue({ success: true });
    const res = await POST(req("POST", { testIds: [T1, T1] }), params());
    expect(res.status).toBe(200);
    expect(linkTestsRecord).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p" }), ID, [T1]);
    expect(await res.json()).toEqual({ requirement: { id: ID, testIds: [T1] } });
  });
});

describe("DELETE /api/requirements/[id]/tests", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await DELETE(req("DELETE", { testIds: [T1] }), params())).status).toBe(403);
  });
  it("400 when neither body nor ?testId is valid", async () => {
    expect((await DELETE(req("DELETE"), params())).status).toBe(400);
    expect((await DELETE(req("DELETE", undefined, "?testId=bad"), params())).status).toBe(400);
  });
  it("200 unlinks via the body", async () => {
    (unlinkTestsRecord as jest.Mock).mockResolvedValue({ success: true });
    const res = await DELETE(req("DELETE", { testIds: [T1] }), params());
    expect(res.status).toBe(200);
    expect(unlinkTestsRecord).toHaveBeenCalledWith(expect.anything(), ID, [T1]);
  });
  it("200 unlinks via ?testId", async () => {
    (unlinkTestsRecord as jest.Mock).mockResolvedValue({ success: true });
    const res = await DELETE(req("DELETE", undefined, `?testId=${T1}`), params());
    expect(res.status).toBe(200);
    expect(unlinkTestsRecord).toHaveBeenCalledWith(expect.anything(), ID, [T1]);
  });
  it("404 cross-project", async () => {
    (unlinkTestsRecord as jest.Mock).mockResolvedValue({ success: false, code: "not_found", error: "nf" });
    expect((await DELETE(req("DELETE", { testIds: [T1] }), params())).status).toBe(404);
  });
});
