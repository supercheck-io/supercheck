/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { requireAuthContext } from "@/lib/auth-context";
import { getExecutionPolicy } from "@/lib/execution/execution-policy";
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: () => false }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (resource: string, action: string) => resource === "test" && action === "run" }));
jest.mock("@/lib/execution/execution-policy", () => ({ getExecutionPolicy: jest.fn(), ExecutionWorkloadError: class extends Error {} }));
jest.mock("@/lib/execution-rate-limiter", () => ({ checkExecutionRateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
const workload = { url: "https://target.example.com/check", vus: 2, durationSeconds: 30 };
const request = (body: unknown) => new NextRequest("https://app.supercheck.io/api/execution/trial-workload", {
  method: "POST", headers: { origin: "https://app.supercheck.io", "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAuthContext).mockResolvedValue({ userId: "member", organizationId: "own-org", project: { id: "project" } } as Awaited<ReturnType<typeof requireAuthContext>>);
  jest.mocked(getExecutionPolicy).mockResolvedValue({ tier: "trial", k6MaxVus: 3, expiresAt: new Date(Date.now() + 600000) } as Awaited<ReturnType<typeof getExecutionPolicy>>);
});
it("generates bounded source for an unregistered public target", async () => {
  const response = await POST(request(workload));
  expect(response.status).toBe(200);
  expect((await response.json()).script).toContain("// supercheck-http-workload:");
});
it.each([{ ...workload, vus: 4 }, { ...workload, script: "arbitrary source" }, { ...workload, url: "http://target.example.com" }])("rejects invalid workload %j", async input => {
  expect((await POST(request(input))).status).toBe(400);
});
it("does not generate a run longer than the remaining entitlement", async () => {
  jest.mocked(getExecutionPolicy).mockResolvedValue({ tier: "trial", k6MaxVus: 3, expiresAt: new Date(Date.now() + 1000) } as Awaited<ReturnType<typeof getExecutionPolicy>>);
  expect((await POST(request(workload))).status).toBe(400);
});
it("refuses callers without an active trial entitlement", async () => {
  jest.mocked(getExecutionPolicy).mockResolvedValue({ tier: "paid" } as Awaited<ReturnType<typeof getExecutionPolicy>>);
  expect((await POST(request(workload))).status).toBe(403);
});
it("refuses cross-origin requests", async () => {
  const foreign = new NextRequest("https://app.supercheck.io/api/execution/trial-workload", {
    method: "POST", headers: { origin: "https://foreign.example", "Content-Type": "application/json" }, body: JSON.stringify(workload),
  });
  expect((await POST(foreign)).status).toBe(403);
});
it("maps policy errors to their status and hides internal failures", async () => {
  const { ExecutionWorkloadError } = jest.requireMock("@/lib/execution/execution-policy");
  jest.mocked(getExecutionPolicy).mockRejectedValueOnce(Object.assign(new ExecutionWorkloadError("Trial expired"), { status: 402 }));
  expect((await POST(request(workload))).status).toBe(402);
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.mocked(getExecutionPolicy).mockRejectedValueOnce(new Error("database unavailable"));
  const response = await POST(request(workload));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("database unavailable");
  spy.mockRestore();
});
