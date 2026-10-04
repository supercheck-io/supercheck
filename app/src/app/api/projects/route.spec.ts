/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getSelectableProjects, getUserProjects } from "@/lib/session";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/session", () => ({ getSelectableProjects: jest.fn(), getUserProjects: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ getCurrentProjectContext: jest.fn(async () => ({ id: "invited-project", organizationId: "team" })) }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn(), getUserRole: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkProjectLimit: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {} }));
beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user", organizationId: "team", isCliAuth: false });
  (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  (getSelectableProjects as jest.Mock).mockResolvedValue([{ id: "home-project", organizationId: "home" }, { id: "invited-project", organizationId: "team" }]);
  (getUserProjects as jest.Mock).mockResolvedValue([{ id: "invited-project", organizationId: "team" }]);
});
it("lists home and invited projects for browser selection", async () => {
  const response = await GET(new NextRequest("https://app.supercheck.io/api/projects"));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toHaveLength(2);
  expect(getSelectableProjects).toHaveBeenCalledWith("user"); expect(getUserProjects).not.toHaveBeenCalled();
});
it("keeps CLI listing scoped to its token organization", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user", organizationId: "team", isCliAuth: true });
  const response = await GET(new NextRequest("https://app.supercheck.io/api/projects"));
  expect(response.status).toBe(200);
  expect(getUserProjects).toHaveBeenCalledWith("user", "team"); expect(getSelectableProjects).not.toHaveBeenCalled();
});
it("checks explicit organization permissions before listing projects", async () => {
  (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
  expect((await GET(new NextRequest("https://app.supercheck.io/api/projects?organizationId=other"))).status).toBe(403);
  expect(getUserProjects).not.toHaveBeenCalled(); expect(getSelectableProjects).not.toHaveBeenCalled();
});
