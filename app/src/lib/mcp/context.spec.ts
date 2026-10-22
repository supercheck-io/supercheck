/** @jest-environment node */
const selectResults: unknown[][] = [];
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => selectResults.shift() ?? [] }) }),
    }),
  },
}));
const resolveProjectPermissionContext = jest.fn();
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  resolveProjectPermissionContext: (...a: unknown[]) => resolveProjectPermissionContext(...a),
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
}));

import { MCP_PROJECT_CLAIM } from "./config";
import { assertCanView, McpAccessDeniedError, resolveMcpCallContext } from "./context";

const claims = { sub: "u1", azp: "client", [MCP_PROJECT_CLAIM]: "p1" };
const perm = { userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "project_viewer" } };

beforeEach(() => {
  selectResults.length = 0;
  jest.clearAllMocks();
  resolveProjectPermissionContext.mockResolvedValue(perm);
  checkPermissionWithContext.mockReturnValue(true);
});

const denied = (p: Promise<unknown>, reason: string) =>
  expect(p).rejects.toMatchObject({ name: "McpAccessDeniedError", reason });

describe("resolveMcpCallContext", () => {
  it("returns the live context when everything still holds", async () => {
    selectResults.push([{ banned: false }], [{ scopes: ["mcp:read"] }]);
    await expect(resolveMcpCallContext(claims)).resolves.toMatchObject({ organizationId: "o1", projectId: "p1", role: "project_viewer" });
  });
  it("rejects a token without a project claim", async () => {
    await denied(resolveMcpCallContext({ sub: "u1", azp: "client" }), "token_missing_project");
  });
  it("rejects banned users", async () => {
    selectResults.push([{ banned: true }]);
    await denied(resolveMcpCallContext(claims), "user_unavailable");
  });
  it("rejects when the consent was revoked", async () => {
    selectResults.push([{ banned: false }], []);
    await denied(resolveMcpCallContext(claims), "consent_revoked");
  });
  it("rejects when the user lost project access", async () => {
    selectResults.push([{ banned: false }], [{ scopes: ["mcp:read"] }]);
    resolveProjectPermissionContext.mockResolvedValue(null);
    await denied(resolveMcpCallContext(claims), "no_project_access");
  });
});

describe("assertCanView", () => {
  it("throws when the role cannot view the resource", () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect(() => assertCanView({ userId: "u", clientId: "c", organizationId: "o", projectId: "p", role: "x" }, "job")).toThrow(McpAccessDeniedError);
  });
});
