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
jest.mock("@/lib/feature-flags", () => ({ isCloudHosted: jest.fn(() => true), isPolarEnabled: jest.fn(() => true) }));

import { GET, POST } from "./route";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; update: jest.Mock; transaction: jest.Mock } };
const { auth } = jest.requireMock("@/utils/auth") as { auth: { api: { getSession: jest.Mock } } };
const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context") as { requireUserAuthContext: jest.Mock };
const { getCurrentUser } = jest.requireMock("@/lib/session") as { getCurrentUser: jest.Mock };

function selectRows(rows: unknown[]) {
  const query = {
    from: jest.fn(), innerJoin: jest.fn(), where: jest.fn(), orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), for: jest.fn().mockResolvedValue(rows), then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

const invite = {
  id: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", email: "invited@example.com",
  role: "project_editor", status: "pending", expiresAt: new Date("2100-01-01"),
  orgName: "Example Org", inviterName: "Admin", inviterEmail: "admin@example.com",
};
const context = { params: Promise.resolve({ token: "11111111-1111-4111-8111-111111111111" }) };

describe("invitation privacy and acceptance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.select.mockReset();
    (isCloudHosted as unknown as jest.Mock).mockReturnValue(true);
    // Polar follows cloud mode unless a test overrides it.
    (isPolarEnabled as jest.Mock).mockImplementation(() => (isCloudHosted as jest.Mock)());
    db.select.mockReturnValue(selectRows([invite]));
    auth.api.getSession.mockResolvedValue(null);
    requireUserAuthContext.mockResolvedValue({ userId: "user-1" });
    getCurrentUser.mockResolvedValue({ id: "user-1", email: invite.email });
  });

  it("rejects malformed invitation IDs without querying PostgreSQL", async () => {
    const invalid = { params: Promise.resolve({ token: "not-a-uuid" }) };
    expect((await GET(new NextRequest("http://localhost/api/invite/not-a-uuid"), invalid)).status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("omits email and inviter details from the public invite lookup", async () => {
    const response = await GET(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111"), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.organizationName).toBe("Example Org");
    expect(body.data).not.toHaveProperty("email");
    expect(body.data).not.toHaveProperty("inviterName");
    expect(body.data).not.toHaveProperty("inviterEmail");
  });

  it("shows invite details to the verified invited account in cloud mode", async () => {
    auth.api.getSession.mockResolvedValue({ user: { email: invite.email, emailVerified: true } });
    const response = await GET(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111"), context);
    const body = await response.json();
    expect(body.data.email).toBe(invite.email);
    expect(body.data.inviterEmail).toBe(invite.inviterEmail);
  });

  it("shows invite details to the invited account in self-hosted mode even if unverified", async () => {
    (isCloudHosted as unknown as jest.Mock).mockReturnValue(false);
    auth.api.getSession.mockResolvedValue({ user: { email: invite.email, emailVerified: false } });
    const response = await GET(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111"), context);
    const body = await response.json();
    expect(body.data.email).toBe(invite.email);
    expect(body.data.inviterEmail).toBe(invite.inviterEmail);
  });

  it("rejects acceptance by an unverified account with the invited email in cloud mode", async () => {
    db.select.mockReturnValueOnce(selectRows([invite])).mockReturnValueOnce(selectRows([{ emailVerified: false }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  const trialRow = jest.fn();
  beforeEach(() => trialRow.mockReset().mockResolvedValue(undefined));

  function acceptance({ projectRows = [{ id: "22222222-2222-4222-8222-222222222222" }], sessionRows = [{ id: "session" }], claimRows = [{ id: invite.id }] } = {}) {
    (isCloudHosted as jest.Mock).mockReturnValue(false);
    auth.api.getSession.mockResolvedValue({ session: { token: "browser-token" } });
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([]));
    const claimWhere = jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(claimRows) });
    const sessionSet = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(sessionRows) }) });
    const insert = jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn().mockResolvedValue([]) }) });
    const tx = {
      select: jest.fn().mockReturnValueOnce(selectRows([{ id: "user-1" }])).mockReturnValue(selectRows(projectRows)), insert,
      execute: jest.fn().mockResolvedValue([{ value: "0" }]),
      query: { executionEntitlements: { findFirst: trialRow } },
      update: jest.fn().mockReturnValueOnce({ set: jest.fn().mockReturnValue({ where: claimWhere }) })
        .mockReturnValue({ set: sessionSet }),
    };
    db.transaction.mockImplementation(async cb => cb(tx));
    return { tx, sessionSet, claimWhere };
  }

  it.each([null, "unlimited"])("denies cloud acceptance without a paid plan (%s)", async plan => {
    const { tx } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    tx.select.mockReset()
      .mockReturnValueOnce(selectRows([{ id: "user-1" }]))
      .mockReturnValueOnce(selectRows([{ subscriptionPlan: plan }]))
      .mockReturnValueOnce(selectRows([]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(402);
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("denies acceptance after a downgrade without consuming the pending invitation", async () => {
    const { tx } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    getCurrentUser.mockResolvedValue({ id: "user-1", email: invite.email, emailVerified: true });
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }])).mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    tx.select.mockReset()
      .mockReturnValueOnce(selectRows([{ id: "user-1" }]))
      .mockReturnValueOnce(selectRows([{ subscriptionPlan: "plus", polarCustomerId: "cus", subscriptionStatus: "active", subscriptionEndsAt: null }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{ max: 2 }]))
      .mockReturnValueOnce(selectRows([{ count: 2 }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(402);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["unpaid", null],
    ["canceled", new Date(Date.now() - 86_400_000)],
  ])("ignores a lapsed %s paid plan when applying the member cap", async (status, endsAt) => {
    const { tx } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    tx.select.mockReset()
      .mockReturnValueOnce(selectRows([{ id: "user-1" }]))
      .mockReturnValueOnce(selectRows([{ subscriptionPlan: "plus", polarCustomerId: "cus", subscriptionStatus: status, subscriptionEndsAt: endsAt }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{ max: 10 }]))
      .mockReturnValueOnce(selectRows([{ count: 1 }]))
      .mockReturnValue(selectRows([{ id: "22222222-2222-4222-8222-222222222222" }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(402);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["admits a member while the trial team has room", 2, 200],
    ["refuses once the trial team cap is reached", 3, 402],
  ])("an organization on a free trial %s", async (_label, count, status) => {
    const { tx } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    (isPolarEnabled as jest.Mock).mockReturnValue(true);
    trialRow.mockResolvedValue({ organizationId: "org-1", expiresAt: new Date(Date.now() + 86_400_000), maxTeamMembers: 3 });
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    tx.select.mockReset()
      .mockReturnValueOnce(selectRows([{ id: "user-1" }]))
      .mockReturnValueOnce(selectRows([{ subscriptionPlan: null }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{ count }]))
      .mockReturnValue(selectRows([{ id: "22222222-2222-4222-8222-222222222222" }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(status);
  });

  it("skips plan limits in cloud mode when Polar billing is not enabled", async () => {
    const { tx } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    (isPolarEnabled as jest.Mock).mockReturnValue(false);
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role: "project_viewer" }]))
      .mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(tx.insert).toHaveBeenCalled();
  });

  it("allows an unverified self-hosted account to accept and select the organization atomically", async () => {
    const { sessionSet, claimWhere } = acceptance();
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: "22222222-2222-4222-8222-222222222222" });
    const claim = new PgDialect().sqlToQuery(claimWhere.mock.calls[0][0]);
    expect(claim.sql).toContain('"invitation"."status" =');
    expect(claim.sql).toContain('"invitation"."expires_at" >');
    expect(claim.params).toContain("pending");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("clears an unrelated project when the invited organization has no project", async () => {
    const { sessionSet } = acceptance({ projectRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: null });
  });

  it("rolls back acceptance when the authenticated session no longer exists", async () => {
    acceptance({ sessionRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(401);
    await expect(db.transaction.mock.results[0].value).rejects.toThrow("INVITE_SESSION_CHANGED");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a concurrent acceptance or cancellation before changing memberships or session", async () => {
    const { tx, sessionSet } = acceptance({ claimRows: [] });
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(400);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
    await expect(db.transaction.mock.results[0].value).rejects.toThrow("INVITE_ALREADY_USED");
  });

  it("allows an account owner to join an invited project without replacing ownership or touching their original organization", async () => {
    const { tx, sessionSet } = acceptance();
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(tx.insert).toHaveBeenCalled();
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: "22222222-2222-4222-8222-222222222222" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("accepts a verified cloud account's assigned project and scopes membership to the invited team", async () => {
    const { tx, sessionSet } = acceptance();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, selectedProjects: ["22222222-2222-4222-8222-222222222222"] }]))
      .mockReturnValueOnce(selectRows([{ emailVerified: true }])).mockReturnValueOnce(selectRows([]));
    tx.select.mockReset()
      .mockReturnValueOnce(selectRows([{ id: "user-1" }]))
      .mockReturnValueOnce(selectRows([{ subscriptionPlan: "pro", polarCustomerId: "cus", subscriptionStatus: "active", subscriptionEndsAt: null }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{ max: 10 }]))
      .mockReturnValueOnce(selectRows([{ count: 1 }]))
      .mockReturnValue(selectRows([{ id: "22222222-2222-4222-8222-222222222222" }]));
    expect((await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context)).status).toBe(200);
    const values = tx.insert.mock.results[0].value.values;
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", organizationId: "org-1", role: "project_editor" }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", projectId: "22222222-2222-4222-8222-222222222222", role: "project_editor" }));
    expect(sessionSet).toHaveBeenCalledWith({ activeOrganizationId: "org-1", activeProjectId: "22222222-2222-4222-8222-222222222222" });
  });

  it("rolls back a project invitation if its assigned project is no longer in the target scope", async () => {
    const { tx, sessionSet } = acceptance({ projectRows: [] });
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, selectedProjects: ["foreign-project"] }]))
      .mockReturnValueOnce(selectRows([]));
    expect((await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context)).status).toBe(400);
    await expect(db.transaction.mock.results[0].value).rejects.toThrow("INVITE_PROJECT_SCOPE_MISMATCH");
    expect(sessionSet).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it.each(["org_owner", "super_admin"])("rejects a stored invitation granting %s", async role => {
    acceptance();
    db.select.mockReset().mockReturnValueOnce(selectRows([{ ...invite, role }])).mockReturnValueOnce(selectRows([]));
    expect((await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context)).status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("requires an interactive session before consuming an invitation", async () => {
    acceptance();
    auth.api.getSession.mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/invite/11111111-1111-4111-8111-111111111111", { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
