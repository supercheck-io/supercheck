/** @jest-environment node */
const rows: Array<{ at: Date | null }> = [];
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) } }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
import { PENDING_ORG_CODE, clearDeletionStateCache, permissionDeniedResponse, permissionDeniedResult } from "./org-state";

beforeEach(() => { clearDeletionStateCache(); rows.length = 0; });

describe("permission denials on a pending organization", () => {
  it("answers a REST denial with the pending code and message", async () => {
    rows.push({ at: new Date() });
    const response = await permissionDeniedResponse("org-1", "Insufficient permissions to create tags");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe(PENDING_ORG_CODE);
    expect(body.error).toMatch(/scheduled for deletion/);
  });

  it("keeps the generic message when the organization is not pending", async () => {
    rows.push({ at: null });
    const response = await permissionDeniedResponse("org-2", "Insufficient permissions to create tags");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Insufficient permissions to create tags" });
  });

  it("answers a server action denial with the code, or the original text", async () => {
    rows.push({ at: new Date() });
    expect(await permissionDeniedResult("org-3", "Insufficient permissions to edit tests")).toMatchObject({ success: false, code: PENDING_ORG_CODE });
    clearDeletionStateCache(); rows.length = 0; rows.push({ at: null });
    expect(await permissionDeniedResult("org-4", "Insufficient permissions to edit tests")).toEqual({ success: false, error: "Insufficient permissions to edit tests", message: "Insufficient permissions to edit tests" });
  });
});
