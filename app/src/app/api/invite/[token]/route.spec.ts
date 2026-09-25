/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(), isAuthError: jest.fn(),
}));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));

import { GET, POST } from "./route";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; transaction: jest.Mock } };
const { auth } = jest.requireMock("@/utils/auth") as { auth: { api: { getSession: jest.Mock } } };
const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context") as { requireUserAuthContext: jest.Mock };
const { getCurrentUser } = jest.requireMock("@/lib/session") as { getCurrentUser: jest.Mock };

function selectRows(rows: unknown[]) {
  const query = {
    from: jest.fn(), innerJoin: jest.fn(), where: jest.fn(), limit: jest.fn().mockResolvedValue(rows),
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

  it("shows invite details to the verified invited account", async () => {
    auth.api.getSession.mockResolvedValue({ user: { email: invite.email, emailVerified: true } });
    const response = await GET(new NextRequest("http://localhost/api/invite/invite-1"), context);
    const body = await response.json();
    expect(body.data.email).toBe(invite.email);
    expect(body.data.inviterEmail).toBe(invite.inviterEmail);
  });

  it("rejects acceptance by an unverified account with the invited email", async () => {
    db.select.mockReturnValueOnce(selectRows([invite])).mockReturnValueOnce(selectRows([{ emailVerified: false }]));
    const response = await POST(new NextRequest("http://localhost/api/invite/invite-1", { method: "POST" }), context);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
