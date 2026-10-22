/** @jest-environment node */
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ authorization: "Bearer sck_live_testcredential123456789" })) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn(async () => false) }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
import { db } from "@/utils/db";
import { authErrorStatus, requireUserAuthContext } from "./auth-context";
function rows(result: unknown[]) {
  return { from: jest.fn().mockReturnThis(), innerJoin: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(result) };
}
function token(permissions: string | null) {
  jest.mocked(db.select).mockReset()
    .mockReturnValueOnce(rows([{ id: "key", userId: "user", projectId: "project-a", permissions }]) as never)
    .mockReturnValueOnce(rows([{ projectId: "project-a", projectName: "Project A", projectOrgId: "org", orgRole: "org_owner" }]) as never);
  jest.mocked(db.update).mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue(undefined) }) }) } as never);
}
it("binds resource access to the token project even for an organization owner", async () => {
  token('["cli:full"]');
  await expect(requireUserAuthContext("project-b")).rejects.toThrow("does not authorize this project");
  token('["cli:full"]');
  expect(await requireUserAuthContext("project-a")).toMatchObject({ userId: "user", projectId: "project-a", isCliAuth: true });
});
it("reports a project-scope denial as 403 and a bad token as 401", async () => {
  token('["cli:full"]');
  const scopeError = await requireUserAuthContext("project-b").catch((error) => error);
  expect(authErrorStatus(scopeError)).toBe(403);
  token('[]');
  const tokenError = await requireUserAuthContext().catch((error) => error);
  expect(authErrorStatus(tokenError)).toBe(401);
});
it.each(['["recording:create"]', '[]', '{"cli:full":true}', 'invalid', ''])("rejects incompatible explicit capabilities %s", async (permissions) => {
  token(permissions);
  await expect(requireUserAuthContext()).rejects.toThrow("Invalid or expired CLI token");
});
it("retains legacy token compatibility when capability markers are absent", async () => {
  token(null);
  expect(await requireUserAuthContext("project-a")).toMatchObject({ projectId: "project-a" });
});

it.each([null, new Date(Date.now() + 60_000)])(
  "rejects a CLI key owned by a currently banned user (%s)",
  async (banExpires) => {
    jest.clearAllMocks();
    token('["cli:full"]');
    jest
      .mocked(db.select)
      .mockReset()
      .mockReturnValueOnce(
        rows([
          {
            id: "key",
            userId: "user",
            projectId: "project-a",
            banned: true,
            banExpires,
          },
        ]) as never,
      );
    await expect(requireUserAuthContext()).rejects.toThrow(
      "Invalid or expired CLI token",
    );
    expect(db.update).not.toHaveBeenCalled();
  },
);
it("accepts a CLI key after a temporary ban expires", async () => {
  token('["cli:full"]');
  const keyRows = rows([
    {
      id: "key",
      userId: "user",
      projectId: "project-a",
      permissions: '["cli:full"]',
      banned: true,
      banExpires: new Date(0),
    },
  ]);
  jest
    .mocked(db.select)
    .mockReset()
    .mockReturnValueOnce(keyRows as never)
    .mockReturnValueOnce(
      rows([
        {
          projectId: "project-a",
          projectName: "Project A",
          projectOrgId: "org",
          orgRole: "org_owner",
        },
      ]) as never,
    );
  expect(await requireUserAuthContext()).toMatchObject({ userId: "user" });
});
