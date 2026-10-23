/** @jest-environment node */
// Only the credential lookup is mocked: the real AuthError, isAuthError and authErrorStatus decide the status.
const requireAuthContext = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  ...jest.requireActual("@/lib/auth-context"),
  requireAuthContext: (...args: unknown[]) => requireAuthContext(...args),
}));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn() }));

import { AuthError } from "@/lib/auth-context";
import { GET } from "./route";

describe("GET /api/context auth failures", () => {
  it("answers 403 for a valid credential that lost access, so clients do not tell users to log in again", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("The token's owner no longer has access to this project", 403));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "The token's owner no longer has access to this project" });
  });

  it("answers 401 for a missing or invalid credential", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("Invalid or expired CLI token"));
    expect((await GET()).status).toBe(401);
  });
});
