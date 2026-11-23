/** @jest-environment node */
import { NextResponse } from "next/server";

const status = jest.fn();
jest.mock("@/lib/server-actions/sre-onboarding", () => ({ getSreOnboardingStatus: (...a: unknown[]) => status(...a) }));
let allowed = true;
const ctx = { organizationId: "org-1", project: { id: "project-1" } };
jest.mock("../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () =>
    allowed ? { success: true, context: ctx } : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));
import { requireSreApiPermissions } from "../_auth";
import { GET } from "./route";

beforeEach(() => {
  allowed = true;
  jest.clearAllMocks();
});

describe("GET /api/sre/onboarding", () => {
  it("requires service and connector view and skips the lookup when denied", async () => {
    allowed = false;
    expect((await GET()).status).toBe(403);
    expect(requireSreApiPermissions).toHaveBeenCalledWith([
      { resource: "sre_service", action: "view" },
      { resource: "sre_connector", action: "view" },
    ]);
    expect(status).not.toHaveBeenCalled();
  });

  it("passes the caller's auth context, so status is scoped to their project", async () => {
    status.mockResolvedValue({ success: true, steps: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(status).toHaveBeenCalledWith(ctx);
  });

  it("maps a failed result to 403", async () => {
    status.mockResolvedValue({ success: false, error: "no" });
    expect((await GET()).status).toBe(403);
  });
});
