/** @jest-environment node */
const mockSession = jest.fn();
const rows: unknown[][] = [];
jest.mock("server-only", () => ({}));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: () => mockSession() }));
jest.mock("@/utils/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => {
    const next = rows.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  } }) }) }) },
}));
import { getImpersonationStatus } from "./impersonation-status";

describe("getImpersonationStatus", () => {
  beforeEach(() => { rows.length = 0; mockSession.mockResolvedValue({ session: { token: "tok_live" } }); });

  it("is not impersonating without a session", async () => {
    mockSession.mockResolvedValue(null);
    expect(await getImpersonationStatus()).toEqual({ isImpersonating: false });
  });

  it("is not impersonating when the session row has no impersonator", async () => {
    rows.push([{ userId: "u1", impersonatedBy: null }]);
    expect(await getImpersonationStatus()).toEqual({ isImpersonating: false });
  });

  it("names the impersonated user and the original admin", async () => {
    rows.push([{ userId: "u2", impersonatedBy: "admin1" }], [{ id: "u2", name: "Pat", email: "p@x" }], [{ id: "admin1", name: "Ada", email: "a@x" }]);
    expect(await getImpersonationStatus()).toEqual({
      isImpersonating: true,
      impersonatedUser: { id: "u2", name: "Pat", email: "p@x" },
      originalAdmin: { id: "admin1", name: "Ada", email: "a@x" },
    });
  });

  it("fails as not impersonating and never logs the session token", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    rows.push(new Error("Failed query: select ... where token = $1\nparams: tok_live") as unknown as unknown[]);
    expect(await getImpersonationStatus()).toEqual({ isImpersonating: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain("tok_live");
    log.mockRestore();
  });

  it("reports a missing user row as null instead of failing", async () => {
    rows.push([{ userId: "u2", impersonatedBy: "admin1" }], [], [{ id: "admin1", name: "Ada", email: "a@x" }]);
    expect(await getImpersonationStatus()).toMatchObject({ isImpersonating: true, impersonatedUser: null });
  });
});
