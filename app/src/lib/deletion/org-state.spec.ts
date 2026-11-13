/** @jest-environment node */
// Each select returns the next queued result: first the organization's pending row, then the caller's membership.
const results: unknown[][] = [];
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => results.shift() ?? [] }) }) }) } }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
const mockAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: () => mockAuth() }));
import { PENDING_ORG_CODE, clearDeletionStateCache, permissionDeniedResponse, permissionDeniedResult } from "./org-state";

beforeEach(() => {
  clearDeletionStateCache();
  results.length = 0;
  mockAuth.mockReset();
  mockAuth.mockResolvedValue({ userId: "u1" });
});
const pendingFor = (isMember: boolean) => results.push([{ at: new Date() }], isMember ? [{ id: "m1" }] : []);

describe("permission denials on a pending organization", () => {
  it("answers a member's REST denial with the pending code and message", async () => {
    pendingFor(true);
    const response = await permissionDeniedResponse("org-1", "Insufficient permissions to create tags");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe(PENDING_ORG_CODE);
    expect(body.error).toMatch(/scheduled for deletion/);
  });

  it("keeps the generic message when the organization is not pending", async () => {
    results.push([{ at: null }]);
    const response = await permissionDeniedResponse("org-2", "Insufficient permissions to create tags");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Insufficient permissions to create tags" });
  });

  it("never tells a non-member (a session still pointing at an organization they left) that it is pending", async () => {
    pendingFor(false);
    expect(await (await permissionDeniedResponse("org-5", "Insufficient permissions")).json()).toEqual({ error: "Insufficient permissions" });
    clearDeletionStateCache();
    results.push([{ at: new Date() }]);
    mockAuth.mockRejectedValue(new Error("no session"));
    expect(await (await permissionDeniedResponse("org-6", "Insufficient permissions")).json()).toEqual({ error: "Insufficient permissions" });
  });

  it("answers a server action denial with the code, or the original text", async () => {
    pendingFor(true);
    expect(await permissionDeniedResult("org-3", "Insufficient permissions to edit tests")).toMatchObject({ success: false, code: PENDING_ORG_CODE });
    clearDeletionStateCache(); results.length = 0; results.push([{ at: null }]);
    expect(await permissionDeniedResult("org-4", "Insufficient permissions to edit tests")).toEqual({ success: false, error: "Insufficient permissions to edit tests", message: "Insufficient permissions to edit tests" });
  });
});
