/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { leaveOrganization, LeaveOrganizationError } from "@/lib/services/leave-organization";
jest.mock("@/lib/services/leave-organization", () => ({ leaveOrganization: jest.fn(), LeaveOrganizationError: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
jest.mock("@/lib/auth-context", () => ({ isAuthError: (e: Error) => e.message === "Authentication required", authErrorStatus: () => 401 }));
const post = (origin = "http://localhost") => POST(new NextRequest("http://localhost/api/organizations/leave", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: "11111111-1111-4111-8111-111111111111" }) }));
beforeEach(() => jest.clearAllMocks());
it("returns success for a browser member", async () => {
  (leaveOrganization as jest.Mock).mockResolvedValue({ organizationId: "org-1" });
  expect((await post()).status).toBe(200);
});
it("requires a same-origin request", async () => {
  expect((await post("https://attacker.invalid")).status).toBe(403);
  expect(leaveOrganization).not.toHaveBeenCalled();
});
it("returns 401 without authentication", async () => {
  (leaveOrganization as jest.Mock).mockRejectedValue(new Error("Authentication required"));
  expect((await post()).status).toBe(401);
});
it.each([400, 403, 404, 409] as const)("preserves membership status %i", async status => {
  (leaveOrganization as jest.Mock).mockRejectedValue(new LeaveOrganizationError("denied", status));
  expect((await post()).status).toBe(status);
});
