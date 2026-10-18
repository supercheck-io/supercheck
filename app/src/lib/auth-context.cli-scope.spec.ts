/** @jest-environment node */
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ authorization: "Bearer sck_live_testcredential123456789" })) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn(async () => false) }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
import { db } from "@/utils/db";
import { requireUserAuthContext } from "./auth-context";
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
it.each(['["recording:create"]', '[]', '{"cli:full":true}', 'invalid', ''])("rejects incompatible explicit capabilities %s", async (permissions) => {
  token(permissions);
  await expect(requireUserAuthContext()).rejects.toThrow("Invalid or expired CLI token");
});
it("retains legacy token compatibility when capability markers are absent", async () => {
  token(null);
  expect(await requireUserAuthContext("project-a")).toMatchObject({ projectId: "project-a" });
});
