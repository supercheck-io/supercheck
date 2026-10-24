/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { checkExecutionRateLimit } from "@/lib/execution-rate-limiter";
import { registerTargetDomain, verifyRegisteredTarget } from "@/lib/execution/target-domain-registry";
jest.mock("@/lib/auth-context", () => {
  class AuthError extends Error { constructor(message: string, readonly status: 401 | 403 = 401) { super(message); } }
  return { requireUserAuthContext: jest.fn(), AuthError, isAuthError: (error: unknown) => error instanceof AuthError };
});
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/execution-rate-limiter", () => ({ checkExecutionRateLimit: jest.fn() }));
jest.mock("@/lib/execution/target-domain-registry", () => ({ registerTargetDomain: jest.fn(), verifyRegisteredTarget: jest.fn(), TargetDomainError: class extends Error { constructor(message: string, readonly status = 400) { super(message); } } }));
jest.mock("@/utils/db", () => ({ db: { query: { executionTargetDomains: { findMany: jest.fn().mockResolvedValue([]) } } } }));
const request = (body: unknown, origin = "https://app.supercheck.io") => new NextRequest("https://app.supercheck.io/api/execution/target-domains", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireUserAuthContext).mockResolvedValue({ userId: "owner", organizationId: "own-org", isCliAuth: false, projectId: null });
  jest.mocked(getUserOrgRole).mockResolvedValue("org_owner" as Awaited<ReturnType<typeof getUserOrgRole>>);
  jest.mocked(checkExecutionRateLimit).mockResolvedValue({ allowed: true, retryAfter: 0 });
});
it("uses the authenticated organization for registration", async () => {
  jest.mocked(registerTargetDomain).mockResolvedValue({ id: "id", hostname: "target.example.com", verificationToken: "proof", verifiedAt: null, verifiedUntil: null } as Awaited<ReturnType<typeof registerTargetDomain>>);
  const response = await POST(request({ action: "register", hostname: "target.example.com" }));
  expect(response.status).toBe(200);
  expect(registerTargetDomain).toHaveBeenCalledWith("own-org", "target.example.com");
});
it("rejects foreign organization input rather than allowing tenant selection", async () => {
  expect((await POST(request({ action: "register", hostname: "target.example.com", organizationId: "foreign" }))).status).toBe(400);
  expect(registerTargetDomain).not.toHaveBeenCalled();
});
it("rejects project credentials and viewers", async () => {
  jest.mocked(requireUserAuthContext).mockResolvedValue({ userId: "owner", organizationId: "own-org", isCliAuth: true, projectId: null });
  expect((await GET()).status).toBe(403);
  jest.mocked(requireUserAuthContext).mockResolvedValue({ userId: "viewer", organizationId: "own-org", isCliAuth: false, projectId: null });
  jest.mocked(getUserOrgRole).mockResolvedValue("project_viewer" as Awaited<ReturnType<typeof getUserOrgRole>>);
  expect((await POST(request({ action: "register", hostname: "target.example.com" }))).status).toBe(403);
  expect(registerTargetDomain).not.toHaveBeenCalled();
});
it("rejects cross-origin and unavailable rate controls before DNS work", async () => {
  expect((await POST(request({ action: "register", hostname: "target.example.com" }, "https://foreign.example"))).status).toBe(403);
  jest.mocked(checkExecutionRateLimit).mockResolvedValue({ allowed: false, retryAfter: 1, reason: "unavailable" });
  expect((await POST(request({ action: "verify", id: "11111111-1111-4111-8111-111111111111" }))).status).toBe(503);
  expect(verifyRegisteredTarget).not.toHaveBeenCalled();
});
const ID = "11111111-1111-4111-8111-111111111111";
it("lists only the caller's organization targets with the TXT proof records", async () => {
  const { db } = jest.requireMock("@/utils/db");
  db.query.executionTargetDomains.findMany.mockResolvedValueOnce([{ id: ID, hostname: "target.example.com", verificationToken: "proof", verifiedAt: null, verifiedUntil: null }]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).data[0]).toMatchObject({ txtName: "_supercheck-load-test.target.example.com", txtValue: "supercheck-load-test=proof" });
});
it("verifies a registered target for the authenticated organization", async () => {
  jest.mocked(verifyRegisteredTarget).mockResolvedValue({ id: ID, hostname: "target.example.com", verificationToken: "proof", verifiedAt: new Date(), verifiedUntil: null } as Awaited<ReturnType<typeof verifyRegisteredTarget>>);
  expect((await POST(request({ action: "verify", id: ID }))).status).toBe(200);
  expect(verifyRegisteredTarget).toHaveBeenCalledWith("own-org", ID);
});
it("removes a target scoped to the organization and reports missing ones as 404", async () => {
  const { db } = jest.requireMock("@/utils/db");
  const returning = jest.fn().mockResolvedValueOnce([{ id: ID }]).mockResolvedValueOnce([]);
  db.delete = jest.fn(() => ({ where: jest.fn(() => ({ returning })) }));
  expect((await POST(request({ action: "remove", id: ID }))).status).toBe(200);
  expect((await POST(request({ action: "remove", id: ID }))).status).toBe(404);
});
it("rejects malformed bodies and unknown actions", async () => {
  expect((await POST(request({ action: "remove", id: "not-a-uuid" }))).status).toBe(400);
  expect((await POST(request({ action: "promote" }))).status).toBe(400);
});
it("maps domain errors to their status and hides unexpected failures", async () => {
  const { TargetDomainError } = jest.requireMock("@/lib/execution/target-domain-registry");
  jest.mocked(registerTargetDomain).mockRejectedValueOnce(Object.assign(new TargetDomainError("limit"), { status: 409 }));
  expect((await POST(request({ action: "register", hostname: "target.example.com" }))).status).toBe(409);
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(registerTargetDomain).mockRejectedValueOnce(new Error("db down"));
  const response = await POST(request({ action: "register", hostname: "target.example.com" }));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("db down");
  spy.mockRestore();
});
it.each([[401, "Authentication required"], [403, "Access denied"]])("preserves a %s authentication failure instead of reporting every one as 401", async (status, message) => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(new AuthError("denied", status));
  const response = await GET();
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
});
