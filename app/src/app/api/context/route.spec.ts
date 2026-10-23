/** @jest-environment node */
const requireAuthContext = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...args: unknown[]) => requireAuthContext(...args),
  isAuthError: (error: unknown) => (error as { name?: string })?.name === "AuthError",
  authErrorStatus: (error: unknown) => ((error as { status?: number }).status === 403 ? 403 : 401),
}));

import { GET } from "./route";

const authError = (message: string, status: 401 | 403) =>
  Object.assign(new Error(message), { name: "AuthError", status });

describe("GET /api/context auth failures", () => {
  it("answers 403 for a credential that is valid but lacks scope, so clients do not tell users to re-login", async () => {
    requireAuthContext.mockRejectedValueOnce(authError("Token not scoped to this project", 403));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Token not scoped to this project" });
  });

  it("answers 401 for a missing or invalid credential", async () => {
    requireAuthContext.mockRejectedValueOnce(authError("Authentication required", 401));
    expect((await GET()).status).toBe(401);
  });
});
