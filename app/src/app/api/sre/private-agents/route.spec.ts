/** @jest-environment node */
import { NextResponse } from "next/server";

const list = jest.fn();
jest.mock("@/lib/server-actions/private-agents", () => ({ getPrivateAgents: (...a: unknown[]) => list(...a) }));
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

describe("GET /api/sre/private-agents", () => {
  it("requires sre_connector view and skips the lookup when denied", async () => {
    allowed = false;
    expect((await GET()).status).toBe(403);
    expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_connector", action: "view" }]);
    expect(list).not.toHaveBeenCalled();
  });

  it("lists agents for the caller's context", async () => {
    list.mockResolvedValue({ success: true, agents: [{ id: "a1" }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, agents: [{ id: "a1" }] });
    expect(list).toHaveBeenCalledWith(ctx);
  });

  it("maps a failed result to 403", async () => {
    list.mockResolvedValue({ success: false, error: "no" });
    expect((await GET()).status).toBe(403);
  });
});
