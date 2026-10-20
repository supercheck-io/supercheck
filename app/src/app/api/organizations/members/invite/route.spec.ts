/** @jest-environment node */
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "./route";
import { getRedisConnection } from "@/lib/queue";
import { requireUserAuthContext } from "@/lib/auth-context";
import { PUT as updateMember, DELETE as removeMember } from "../[memberId]/route";
import { GET as listMembers } from "../route";
import { DELETE as cancelInvite, POST as resendInvite } from "./[invitationId]/route";
import { GET as orgStats } from "../../stats/route";
import { GET as orgInvites } from "../../invitations/route";
import { GET as orgDetail, PUT as orgUpdate, DELETE as orgDelete } from "../../[id]/route";
import { POST as createProject } from "../../../projects/route";
import { GET as billingCurrent } from "../../../billing/current/route";
import { GET as billingUsage } from "../../../billing/usage/route";
import { GET as billingSettings, PATCH as updateBillingSettings } from "../../../billing/settings/route";
import { GET as billingNotifications } from "../../../billing/notifications/route";
import { db } from "@/utils/db";
import { checkTeamMemberLimit } from "@/lib/middleware/plan-enforcement";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { renderOrganizationInvitationEmail } from "@/lib/email-renderer";
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn(), transaction: jest.fn(), query: { organization: { findFirst: jest.fn(async () => ({ name: "Host team" })) } } } }));
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
  mockSelect.mockReturnValueOnce(rows([{ id: "own-org-owner", role: "user", email: "owner@example.com" }]))
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
  const where = mockSelect.mock.results[3].value.where.mock.calls[0][0];
  expect(new PgDialect().sqlToQuery(where).params).toContain("host");
  expect(renderOrganizationInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({
    projectInfo: expect.stringContaining("Other active projects in this team remain visible with read-only access"),
  }));
});
it("rejects a foreign or archived project before creating the invitation", async () => {
  mockSelect.mockReset().mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([]));
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

describe("seat limit", () => {
  function useTransaction(execute = jest.fn().mockResolvedValue([{ value: "0" }])) {
    (db.transaction as jest.Mock).mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ execute, select: mockSelect, insert: mockInsert }));
    return execute;
  }

  it("counts members plus pending invitations on the transaction and rejects at the limit", async () => {
    useTransaction();
    (checkTeamMemberLimit as jest.Mock)
      .mockResolvedValueOnce({ allowed: true, limit: 3 })
      .mockResolvedValueOnce({ allowed: false, error: "Team member limit reached" });
    mockSelect.mockReturnValueOnce(rows([{ count: 2 }])).mockReturnValueOnce(rows([{ count: 1 }]));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(checkTeamMemberLimit).toHaveBeenLastCalledWith("host", 3);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates the invitation on the transaction when under the limit", async () => {
    useTransaction();
    (checkTeamMemberLimit as jest.Mock).mockResolvedValueOnce({ allowed: true, limit: 5 });
    mockSelect.mockReturnValueOnce(rows([{ count: 1 }])).mockReturnValueOnce(rows([{ count: 1 }]));

    expect((await POST(request())).status).toBe(200);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "host", status: "pending" }));
  });

  it("returns 503 with Retry-After when the lock times out", async () => {
    useTransaction(
      jest.fn()
        .mockResolvedValueOnce([{ value: "0" }])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(Object.assign(new Error("t"), { code: "55P03" })),
    );
    (checkTeamMemberLimit as jest.Mock).mockResolvedValueOnce({ allowed: true, limit: 5 });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

const memberParams = { params: Promise.resolve({ memberId: "victim" }) };
const inviteParams = { params: Promise.resolve({ invitationId: "invite" }) };
const orgParams = { params: Promise.resolve({ id: "other-org" }) };
it.each([
  ["invite member", () => POST(request())],
  ["change member roles", () => updateMember(request(), memberParams)],
  ["remove member", () => removeMember(request(), memberParams)],
  ["list members", () => listMembers()],
  ["cancel invite", () => cancelInvite(request(), inviteParams)],
  ["resend invite", () => resendInvite(request(), inviteParams)],
  ["organization statistics", () => orgStats()],
  ["organization invitations", () => orgInvites()],
  ["organization details", () => orgDetail(request(), orgParams)],
  ["rename organization", () => orgUpdate(request(), orgParams)],
  ["delete organization", () => orgDelete(request(), orgParams)],
  ["create another project", () => createProject(request())],
  ["billing totals", () => billingCurrent()],
  ["billing usage", () => billingUsage()],
  ["billing settings", () => billingSettings()],
  ["change billing settings", () => updateBillingSettings(request())],
  ["billing notifications", () => billingNotifications(request())],
])("project tokens cannot perform organization-wide %s even if the owner is an org_owner", async (_name, invoke) => {
  const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context");
  requireUserAuthContext.mockResolvedValueOnce({ userId: "org-owner", organizationId: "host", projectId: "only-project-a", isCliAuth: true });
  const response = await (invoke as () => Promise<Response>)();
  expect(response.status).toBe(403);
  expect(mockSelect).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(getUserOrgRole).not.toHaveBeenCalled();
});

describe("accepted invitation quota", () => {
  const entries = new Map<string, number>();
  const redis = {
    eval: jest.fn(
      async (
        _script: string,
        _keys: number,
        _key: string,
        now: number,
        window: number,
        max: number,
        token: string,
      ) => {
        for (const [id, score] of entries)
          if (score <= now - window) entries.delete(id);
        if (entries.size >= max)
          return Math.max(1, Math.min(...entries.values()) + window - now);
        entries.set(token, now);
        return 0;
      },
    ),
    zrem: jest.fn(async (_key: string, token: string) =>
      Number(entries.delete(token)),
    ),
  };
  function validCandidate() {
    mockSelect
      .mockReset()
      .mockReturnValueOnce(rows([]))
      .mockReturnValueOnce(rows([]))
      .mockReturnValueOnce(rows([{ id: "host-project", name: "Project" }]));
  }
  beforeEach(() => {
    entries.clear();
    (getUserOrgRole as jest.Mock).mockReset().mockResolvedValue("org_owner");
    (getRedisConnection as jest.Mock).mockResolvedValue(redis);
    (requireUserAuthContext as jest.Mock).mockReset().mockResolvedValue({
      userId: "inviter",
      organizationId: "host",
    });
    (checkTeamMemberLimit as jest.Mock)
      .mockReset()
      .mockResolvedValue({ allowed: true });
    validCandidate();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(["invalid", "duplicate", "foreign-project", "unauthorized"])(
    "does not reserve quota for %s requests",
    async (reason) => {
      if (reason === "duplicate")
        mockSelect
          .mockReset()
          .mockReturnValueOnce(rows([]))
          .mockReturnValueOnce(rows([{ id: "pending" }]));
      if (reason === "foreign-project")
        mockSelect
          .mockReset()
          .mockReturnValueOnce(rows([]))
          .mockReturnValueOnce(rows([]))
          .mockReturnValueOnce(rows([]));
      if (reason === "unauthorized")
        (getUserOrgRole as jest.Mock).mockResolvedValue("project_editor");
      const response = await POST(
        reason === "invalid" ? request("org_owner") : request(),
      );
      expect(response.status).toBe(reason === "unauthorized" ? 403 : 400);
      expect(redis.eval).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
    },
  );

  it("counts distinct accepted invitations at the same millisecond and rejects the eleventh", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (let i = 0; i < 10; i++) {
      validCandidate();
      expect((await POST(request())).status).toBe(200);
    }
    validCandidate();
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(entries.size).toBe(10);
    expect(redis.zrem).not.toHaveBeenCalled();
  });

  it("releases reserved quota when the subscription seat limit rejects an invitation", async () => {
    (checkTeamMemberLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      error: "Seat limit",
    });
    expect((await POST(request())).status).toBe(403);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(0);
  });

  it("releases reserved quota on insert failure", async () => {
    values.mockReturnValue({
      returning: jest.fn().mockRejectedValue(new Error("DB unavailable")),
    });
    expect((await POST(request())).status).toBe(500);
    expect(redis.zrem).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(0);
  });
});
