/** @jest-environment node */
import { NextRequest } from "next/server";

const mockResolve = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  resolveProjectPermissionContext: (...a: unknown[]) => mockResolve(...a),
  checkPermissionWithContext: jest.fn(() => true),
  // Pass-through rate limiter.
  withRateLimit: () => (req: NextRequest, handler: (r: NextRequest, c: unknown) => unknown) => handler(req, {}),
}));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn().mockResolvedValue({ userId: "sa-1" }),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/encryption", () => ({ decryptValue: jest.fn(() => "plaintext") }));
const mockRows = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => mockRows() }) }) } }));
jest.mock("@/db/schema", () => ({ projectVariables: { id: "id", projectId: "projectId" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn() }));

import { POST } from "./route";

const PROJECT = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const VARIABLE = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const call = () =>
  POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: PROJECT, variableId: VARIABLE }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.mockResolvedValue([{ isSecret: true, encryptedValue: "enc", key: "K", description: null }]);
});

describe("POST /api/projects/[id]/variables/[variableId]/decrypt", () => {
  it("resolves the caller from real membership, so a non-member super admin gets 404 and no plaintext", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await call();
    expect(mockResolve).toHaveBeenCalledWith("sa-1", PROJECT, { requireMembership: true });
    expect(res.status).toBe(404);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("reveals the value to a member with view_secrets", async () => {
    mockResolve.mockResolvedValue({ userId: "sa-1", organizationId: "org-1", project: { id: PROJECT, userRole: "org_owner" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.value).toBe("plaintext");
  });
});
