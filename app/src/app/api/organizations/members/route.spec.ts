/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(async () => "org_owner") }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
import { GET } from "./route";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";

// Chainable query stub that resolves to `rows` wherever the chain ends.
const query = (rows: unknown[]): unknown => {
  const chain: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res) };
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  return chain;
};

it("reports a pending invitation past its expiry as expired", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: "org-1", isCliAuth: false });
  const day = 86400000;
  (db.select as jest.Mock)
    .mockReturnValueOnce(query([]))
    .mockReturnValueOnce(query([
      { id: "a", status: "pending", expiresAt: new Date(Date.now() - day) },
      { id: "b", status: "pending", expiresAt: new Date(Date.now() + day) },
    ]))
    .mockReturnValueOnce(query([{ role: "org_owner" }]))
    .mockReturnValueOnce(query([]));
  const body = await (await GET()).json();
  expect(body.data.invitations.map((i: { status: string }) => i.status)).toEqual(["expired", "pending"]);
});
