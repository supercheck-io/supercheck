/** @jest-environment node */
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ authorization: "Bearer sck_live_testcredential123456789" })) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn(async () => false) }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));

import { db } from "@/utils/db";
import { AuthError, authErrorResponse, authErrorStatus, requireAuthContext } from "./auth-context";

const rows = (result: unknown[]) =>
  ({
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  }) as never;

function tokenWithAccess(context: Record<string, unknown> | undefined) {
  jest
    .mocked(db.select)
    .mockReset()
    .mockReturnValueOnce(rows([{ id: "key", userId: "user", projectId: "project-a", permissions: '["cli:full"]' }]))
    .mockReturnValueOnce(rows(context ? [context] : []));
  jest.mocked(db.update).mockReturnValue({
    set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue(undefined) }) }),
  } as never);
}

const caught = async () => requireAuthContext().then(() => undefined, (error: unknown) => error);

describe("a valid CLI token whose owner lost access", () => {
  it("is a 403, not an invalid-token 401, when the owner left the organization and project", async () => {
    tokenWithAccess({ projectId: "project-a", projectName: "A", projectOrgId: "org" });
    const error = await caught();
    expect(error).toBeInstanceOf(AuthError);
    expect(authErrorStatus(error)).toBe(403);
  });

  it("authErrorResponse keeps the 403 and message", async () => {
    const response = authErrorResponse(new AuthError("no access", 403));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "no access" });
    expect(authErrorResponse(new AuthError("expired")).status).toBe(401);
  });

  it("stays a 401 when the token is unknown or its project is gone", async () => {
    tokenWithAccess(undefined);
    expect(authErrorStatus(await caught())).toBe(401);
    jest.mocked(db.select).mockReset().mockReturnValueOnce(rows([]));
    expect(authErrorStatus(await caught())).toBe(401);
  });

  it("still authenticates an owner who has a role", async () => {
    tokenWithAccess({ projectId: "project-a", projectName: "A", projectOrgId: "org", orgRole: "org_owner" });
    await expect(requireAuthContext()).resolves.toMatchObject({ userId: "user", isCliAuth: true });
  });
});
