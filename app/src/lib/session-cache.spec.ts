/** @jest-environment node */
const getSession = jest.fn();
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } } }));
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Headers()) }));

import { getCachedAuthSession } from "./session-cache";

describe("browser session suspension", () => {
  it.each([
    ["a permanent ban", { banned: true, banExpires: null }, false],
    ["an active temporary ban", { banned: true, banExpires: new Date(Date.now() + 60_000) }, false],
    ["an expired temporary ban", { banned: true, banExpires: new Date(Date.now() - 60_000) }, true],
    ["no ban", { banned: false, banExpires: null }, true],
  ])("with %s", async (_label, ban, allowed) => {
    getSession.mockResolvedValue({ session: { token: "t" }, user: { id: "u", ...ban } });
    expect(Boolean(await getCachedAuthSession())).toBe(allowed);
  });
  it("returns null without a session", async () => {
    getSession.mockResolvedValue(null);
    expect(await getCachedAuthSession()).toBeNull();
  });
});
