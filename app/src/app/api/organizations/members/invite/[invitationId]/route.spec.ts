/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(async () => "org_owner") }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => null) }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkTeamMemberLimit: jest.fn() }));
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ insertWithinPlanLimit: jest.fn() }));
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: jest.fn() } }));
jest.mock("@/lib/email-renderer", () => ({ renderOrganizationInvitationEmail: jest.fn(async () => ({ subject: "s", text: "t", html: "h" })) }));
import { DELETE, POST } from "./route";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getRedisConnection } from "@/lib/queue";
import { EmailService } from "@/lib/email-service";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";

const ID = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const ctx = { params: Promise.resolve({ invitationId: ID }) };
const req = (method: string) => new NextRequest(`http://localhost/api/organizations/members/invite/${ID}`, { method });
const invite = { id: ID, email: "i@example.com", role: "project_editor", status: "pending", expiresAt: new Date(Date.now() + 86400000), organizationId: "org-1", orgName: "Org", selectedProjects: ["11111111-1111-4111-8111-111111111111"] };

beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: "org-1", isCliAuth: false });
  (db.select as jest.Mock)
    .mockReset()
    .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [invite] }) }), where: () => ({ limit: async () => [invite] }) }) })
    .mockReturnValue({ from: () => ({ where: async () => [{ name: "Alpha" }] }) });
});

it("does not report a cancel as successful when the invitation was accepted meanwhile", async () => {
  const where = jest.fn(() => ({ returning: async () => [] }));
  (db.update as jest.Mock).mockReturnValue({ set: () => ({ where }) });
  expect((await DELETE(req("DELETE"), ctx)).status).toBe(409);
});

it("keeps the project assignment text in a resent invitation email", async () => {
  (EmailService.getInstance as jest.Mock).mockReturnValue({ sendEmail: async () => ({ success: true }) });
  await POST(req("POST"), ctx);
  expect(renderOrganizationInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ projectInfo: expect.stringContaining("Alpha") }));
});

it("does not consume the resend rate limit for an invitation that cannot be resent", async () => {
  const zadd = jest.fn();
  (getRedisConnection as jest.Mock).mockResolvedValueOnce({ zremrangebyscore: jest.fn(), zcard: async () => 0, zadd, expire: jest.fn() });
  (db.select as jest.Mock).mockReset().mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ ...invite, status: "accepted" }] }) }) }) });
  expect((await POST(req("POST"), ctx)).status).toBe(400);
  expect(zadd).not.toHaveBeenCalled();
});
