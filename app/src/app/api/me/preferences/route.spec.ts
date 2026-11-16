/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/deletion/org-state", () => ({ permissionDeniedResponse: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: jest.fn(),
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSetupReadRateLimit: jest.fn(), checkSetupPersonaRateLimit: jest.fn() }));
jest.mock("@/lib/setup/setup-state", () => ({ getUserPreferences: jest.fn(), setUserPersona: jest.fn() }));

import { GET, PUT } from "./route";
import { requireAuth } from "@/lib/rbac/middleware";
import { checkSetupPersonaRateLimit, checkSetupReadRateLimit } from "@/lib/sre/sre-rate-limiter";
import { getUserPreferences, setUserPersona } from "@/lib/setup/setup-state";

const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/me/preferences", { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
  (checkSetupReadRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (checkSetupPersonaRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (getUserPreferences as jest.Mock).mockResolvedValue({ persona: "qa", seen: true });
  (setUserPersona as jest.Mock).mockImplementation(async (_u: string, persona: string | null) => ({ persona, seen: true }));
});

describe("GET /api/me/preferences", () => {
  it("returns the caller's preferences", async () => {
    const res = await GET(req("GET"));
    expect(await res.json()).toEqual({ persona: "qa", seen: true });
    expect(getUserPreferences).toHaveBeenCalledWith("u1");
  });
  it("401 anonymous or bearer, 429 limited, 500 on failure", async () => {
    (requireAuth as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await GET(req("GET", undefined, { authorization: "Bearer t" }))).status).toBe(401);
    (checkSetupReadRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 1000 });
    expect((await GET(req("GET"))).status).toBe(429);
    jest.spyOn(console, "error").mockImplementation(() => {});
    (getUserPreferences as jest.Mock).mockRejectedValueOnce(new Error("db"));
    expect((await GET(req("GET"))).status).toBe(500);
  });
});

describe("PUT /api/me/preferences", () => {
  it("saves a persona for the session user only", async () => {
    const res = await PUT(req("PUT", { persona: "sre" }));
    expect(await res.json()).toEqual({ persona: "sre", seen: true });
    expect(setUserPersona).toHaveBeenCalledWith("u1", "sre");
  });
  it("accepts null (skip) and ignores a body userId by rejecting it", async () => {
    expect((await PUT(req("PUT", { persona: null }))).status).toBe(200);
    expect((await PUT(req("PUT", { persona: "qa", userId: "victim" }))).status).toBe(400);
    expect(setUserPersona).toHaveBeenCalledTimes(1);
  });
  it("uses the effective (impersonated) user", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ userId: "eff" });
    await PUT(req("PUT", { persona: "leader" }));
    expect(setUserPersona).toHaveBeenCalledWith("eff", "leader");
  });
  it("400 for unknown persona and bad JSON, 413 when large", async () => {
    expect((await PUT(req("PUT", { persona: "ceo" }))).status).toBe(400);
    expect((await PUT(req("PUT", "{nope"))).status).toBe(400);
    expect((await PUT(req("PUT", { persona: "x".repeat(70 * 1024) }))).status).toBe(413);
  });
  it("401, 429, 503, 500", async () => {
    (requireAuth as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect((await PUT(req("PUT", { persona: "qa" }))).status).toBe(401);
    expect((await PUT(req("PUT", { persona: "qa" }, { authorization: "Bearer t" }))).status).toBe(401);
    (checkSetupPersonaRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 1000 });
    expect((await PUT(req("PUT", { persona: "qa" }))).status).toBe(429);
    (checkSetupPersonaRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, unavailable: true });
    expect((await PUT(req("PUT", { persona: "qa" }))).status).toBe(503);
    jest.spyOn(console, "error").mockImplementation(() => {});
    (setUserPersona as jest.Mock).mockRejectedValueOnce(new Error("db"));
    expect((await PUT(req("PUT", { persona: "qa" }))).status).toBe(500);
  });
});
