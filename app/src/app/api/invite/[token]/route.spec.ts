/** @jest-environment node */

import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(), isAuthError: jest.fn(),
}));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/lib/feature-flags", () => ({ isCloudHosted: jest.fn(() => true) }));

import { GET, POST } from "./route";
import { isCloudHosted } from "@/lib/feature-flags";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; update: jest.Mock; transaction: jest.Mock } };
const { auth } = jest.requireMock("@/utils/auth") as { auth: { api: { getSession: jest.Mock } } };
const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context") as { requireUserAuthContext: jest.Mock };
const { getCurrentUser } = jest.requireMock("@/lib/session") as { getCurrentUser: jest.Mock };

function selectRows(rows: unknown[]) {
  const query = {
    from: jest.fn(), innerJoin: jest.fn(), where: jest.fn(), orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

const invite = {
  id: "invite-1", organizationId: "org-1", email: "invited@example.com",
  role: "project_editor", status: "pending", expiresAt: new Date("2100-01-01"),
  orgName: "Example Org", inviterName: "Admin", inviterEmail: "admin@example.com",
};
const context = { params: Promise.resolve({ token: "invite-1" }) };

describe("invitation privacy and acceptance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.select.mockReset();
    (isCloudHosted as unknown as jest.Mock).mockReturnValue(true);
    db.select.mockReturnValue(selectRows([invite]));
    auth.api.getSession.mockResolvedValue(null);
    requireUserAuthContext.mockResolvedValue({ userId: "user-1" });
    getCurrentUser.mockResolvedValue({ id: "user-1", email: invite.email });
  });

  it("omits email and inviter details from the public invite lookup", async () => {
    const response = await GET(new NextRequest("http://localhost/api/invite/invite-1"), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.organizationName).toBe("Example Org");
    expect(body.data).not.toHaveProperty("email");
    expect(body.data).not.toHaveProperty("inviterName");
    expect(body.data).not.toHaveProperty("inviterEmail");
  });

  it("shows invite details to the verified invited account in cloud mode", async () => {
    auth.api.getSession.mockResolvedValue({ user: { email: invite.email, emailVerified: true } });
    const response = await GET(new NextRequest("http://localhost/api/invite/invite-1"), context);
    const body = await response.json();
    expect(body.data.email).toBe(invite.email);
    expect(body.data.inviterEmail).toBe(invite.inviterEmail);
  });

  it("shows invite details to the invited account in self-hosted mode even if unverified", async () => {
    (isCloudHosted as unknown as jest.Mock).mockReturnValue(false);
    auth.api.getSession.mockResolvedValue({ user: { email: invite.email, emailVerified: false } });
    const response = await GET(new NextRequest("http://localhost/api/invite/invite-1"), context);
    const body = await response.json();
    expect(body.data.email).toBe(invite.email);
    expect(body.data.inviterEmail).toBe(invite.inviterEmail);
  });

  it("rejects acceptance by an unverified account with the invited email in cloud mode", async () => {
    db.select.mockReturnValueOnce(selectRows([invite])).mockReturnValueOnce(selectRows([{ emailVerified: false }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  function acceptance({ projectRows = [{ id: "invited-project" }], sessionRows = [{ id: "session" }], claimRows = [{ id: invite.id }] } = {}) {
    (isCloudHosted as jest.Mock).mockReturnValue(false);
    auth.api.getSession.mockResolvedValue({ session: { token: "browser-token" } });
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([]));
    const claimWhere = jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(claimRows) });
    const sessionSet = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(sessionRows) }) });
    const insert = jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue([]) }) });
    const tx = {
      select: jest.fn().mockReturnValue(selectRows(projectRows)), insert,
      update: jest.fn().mockReturnValueOnce({ set: jest.fn().mockReturnValue({ where: claimWhere }) })
        .mockReturnValue({ set: sessionSet }),
    };
    db.transaction.mockImplementation(async cb => cb(tx));
    return { tx, sessionSet, claimWhere };
  }

  it("allows an unverified self-hosted account to accept and select the organization atomically", async () => {
    const { sessionSet, claimWhere } = acceptance();
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: "invited-project" });
    const claim = new PgDialect().sqlToQuery(claimWhere.mock.calls[0][0]);
    expect(claim.sql).toContain('"invitation"."status" =');
    expect(claim.sql).toContain('"invitation"."expires_at" >');
    expect(claim.params).toContain("pending");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("clears an unrelated project when the invited organization has no project", async () => {
    const { sessionSet } = acceptance({ projectRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: null });
  });

  it("rolls back acceptance when the authenticated session no longer exists", async () => {
    acceptance({ sessionRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(401);
    await expect(db.transaction.mock.results[0].value).rejects.toThrow("INVITE_SESSION_CHANGED");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a concurrent acceptance or cancellation before changing memberships or session", async () => {
    const { tx, sessionSet } = acceptance({ claimRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(400);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    await expect(db.transaction.mock.results[0].value).rejects.toThrow("INVITE_ALREADY_USED");
  });

  it("requires an interactive session before consuming an invitation", async () => {
    acceptance();
    auth.api.getSession.mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
