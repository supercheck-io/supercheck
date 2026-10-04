/** @jest-environment node */
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "./route";
import { db } from "@/utils/db";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn(), query: { organization: { findFirst: jest.fn(async () => ({ name: "Host team" })) } } } }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(async () => ({ userId: "inviter", organizationId: "host" })), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => null) }));
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: jest.fn(() => ({ sendEmail: jest.fn(async () => ({ success: true })) })) } }));
jest.mock("@/lib/email-renderer", () => ({ renderOrganizationInvitationEmail: jest.fn(async () => ({ subject: "Invitation", text: "", html: "" })) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkTeamMemberLimit: jest.fn(async () => ({ allowed: true })) }));

const mockSelect = db.select as jest.Mock;
const mockInsert = db.insert as jest.Mock;
const values = jest.fn();
function rows(data: unknown[]) {
  return { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(data),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(data).then(resolve) };
}
function request(role = "project_editor", selectedProjects = ["host-project"]) {
  return new NextRequest("https://app.supercheck.io/api/organizations/members/invite", { method: "POST", body: JSON.stringify({ email: "owner@example.com", role, selectedProjects }) });
}
beforeEach(() => {
  jest.clearAllMocks(); mockSelect.mockReset();
  (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
  mockSelect.mockReturnValueOnce(rows([{ count: 1 }]))
    .mockReturnValueOnce(rows([{ id: "own-org-owner", role: "user", email: "owner@example.com" }]))
    .mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([{ id: "host-project", name: "Project" }]));
  values.mockReturnValue({ returning: jest.fn(async () => [{ id: "invite", email: "owner@example.com", role: "project_editor", expiresAt: new Date() }]) });
  mockInsert.mockReturnValue({ values });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
it("invites an existing account owner into the host's project with only the requested role", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "host", role: "project_editor", selectedProjects: ["host-project"] }));
  // Project validation is bound to the host rather than the invitee's home.
  const where = mockSelect.mock.results[4].value.where.mock.calls[0][0];
  expect(new PgDialect().sqlToQuery(where).params).toContain("host");
  expect(renderOrganizationInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({
    projectInfo: expect.stringContaining("Other active projects in this team remain visible with read-only access"),
  }));
});
it("rejects a foreign or archived project before creating the invitation", async () => {
  mockSelect.mockReset().mockReturnValueOnce(rows([{ count: 1 }])).mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([]));
  expect((await POST(request())).status).toBe(400); expect(mockInsert).not.toHaveBeenCalled();
});
it.each(["org_owner", "super_admin"])("cannot grant the %s role via invitations", async role => {
  expect((await POST(request(role))).status).toBe(400); expect(mockInsert).not.toHaveBeenCalled();
});
it("requires explicit project assignments for editor invitations", async () => {
  expect((await POST(request("project_editor", []))).status).toBe(400); expect(mockInsert).not.toHaveBeenCalled();
});
it("prevents an invited editor from inviting members", async () => {
  (getUserOrgRole as jest.Mock).mockResolvedValue("project_editor");
  expect((await POST(request())).status).toBe(403); expect(mockInsert).not.toHaveBeenCalled();
});
it("prevents an org admin from granting another admin", async () => {
  (getUserOrgRole as jest.Mock).mockResolvedValue("org_admin");
  expect((await POST(request("org_admin", []))).status).toBe(403); expect(mockInsert).not.toHaveBeenCalled();
});
