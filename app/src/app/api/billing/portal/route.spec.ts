/** @jest-environment node */
jest.mock("@/lib/deletion/org-state");
import { NextRequest } from "next/server";

const mockFindFirst = jest.fn();
const mockCreateSession = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { organization: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } } } }));
jest.mock("@/db/schema", () => ({ organization: { id: "id", polarCustomerId: "polarCustomerId" } }));
jest.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, ne: (...a: unknown[]) => a }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: async () => ({ userId: "u1", organizationId: "org-1", isCliAuth: false }),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true, getPolarConfig: () => ({ accessToken: "t", server: "sandbox" }) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: async () => "org_owner", getImpersonationState: async () => "none" }));
jest.mock("@/lib/rbac/permissions", () => ({ Role: { ORG_OWNER: "org_owner" } }));
jest.mock("@/lib/security/same-origin", () => ({ requireSameOriginRequest: () => null }));
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ customerSessions: { create: (...args: unknown[]) => mockCreateSession(...args) } }) }));
import { POST } from "./route";

const request = () => new NextRequest("http://localhost/api/billing/portal", { method: "POST" });

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSession.mockResolvedValue({ customer_portal_url: "https://portal.example/s" });
});

it("opens the portal for a customer bound only to this organization", async () => {
  mockFindFirst.mockResolvedValueOnce({ polarCustomerId: "cus_1" }).mockResolvedValueOnce(undefined);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: "https://portal.example/s" });
});

it("refuses when another organization shares the customer, so no other plan or invoice is shown", async () => {
  mockFindFirst.mockResolvedValueOnce({ polarCustomerId: "cus_1" }).mockResolvedValueOnce({ id: "org-2" });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(mockCreateSession).not.toHaveBeenCalled();
});
