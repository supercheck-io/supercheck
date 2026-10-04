/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/session", () => ({ getUserOrganizations: jest.fn() }));
jest.mock("@/lib/services/organization-management", () => {
  class OrganizationManagementError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  return { createOrganization: jest.fn(), switchOrganization: jest.fn(), OrganizationManagementError };
});
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrganizations } from "@/lib/session";
import { createOrganization, switchOrganization, OrganizationManagementError } from "@/lib/services/organization-management";
import { GET, POST } from "./route";
import { POST as SWITCH } from "./switch/route";

function request(body: unknown, origin = "https://app.supercheck.io") {
  return new NextRequest("https://app.supercheck.io/api/organizations", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("organization routes", () => {
  beforeEach(() => jest.clearAllMocks());
  it("returns only the current organization for legacy multiple memberships", async () => {
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user", organizationId: "org-b" });
    (getUserOrganizations as jest.Mock).mockResolvedValue([{ id: "org-a" }, { id: "org-b" }]);
    expect(await (await GET()).json()).toMatchObject({ activeOrganizationId: "org-b", data: [{ id: "org-b", isActive: true }] });
  });
  it("does not allow clients to choose the plan or billing customer when creating an organization", async () => {
    expect((await POST(request({ name: "New team", subscriptionPlan: "pro", polarCustomerId: "paid-customer" }))).status).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
  });
  it("rejects a valid creation request under the single organization policy", async () => {
    (createOrganization as jest.Mock).mockRejectedValue(new OrganizationManagementError("Organization creation is disabled", 403));
    expect((await POST(request({ name: "  New team  " }))).status).toBe(403);
    expect(createOrganization).toHaveBeenCalledWith("New team");
  });
  it.each([POST, SWITCH])("rejects cross-origin mutations before management", async handler => {
    expect((await handler(request({ name: "New team" }, "https://attacker.example"))).status).toBe(403);
    expect(createOrganization).not.toHaveBeenCalled();
    expect(switchOrganization).not.toHaveBeenCalled();
  });
  it("rejects a valid organization switch", async () => {
    (switchOrganization as jest.Mock).mockRejectedValue(new OrganizationManagementError("Organization switching is disabled", 403));
    expect((await SWITCH(request({ organizationId: "11111111-1111-4111-8111-111111111111" }))).status).toBe(403);
  });
  it("validates the switch target", async () => {
    expect((await SWITCH(request({ organizationId: "not-a-uuid" }))).status).toBe(400);
    expect(switchOrganization).not.toHaveBeenCalled();
  });
});
