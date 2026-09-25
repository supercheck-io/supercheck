/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));

import { POST } from "./route";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; insert: jest.Mock } };
const { hasPermissionForUser } = jest.requireMock("@/lib/rbac/middleware") as { hasPermissionForUser: jest.Mock };
const { requireUserAuthContext } = jest.requireMock("@/lib/auth-context") as { requireUserAuthContext: jest.Mock };

function selectRows(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

describe("project member tenant boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireUserAuthContext.mockResolvedValue({ userId: "admin-1" });
    hasPermissionForUser.mockResolvedValue(true);
  });

  it("rejects a target user who does not belong to the project's organization", async () => {
    db.select
      .mockReturnValueOnce(selectRows([{ organizationId: "org-1" }]))
      .mockReturnValueOnce(selectRows([{ id: "foreign-user", name: "Other", email: "other@example.com" }]))
      .mockReturnValueOnce(selectRows([]));
    const response = await POST(new NextRequest("http://localhost/api/projects/project-1/members", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "foreign-user", role: "project_admin" }),
    }), { params: Promise.resolve({ id: "project-1" }) });
    expect(response.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
