/** @jest-environment node */
const rows: { key: string }[] = [];
const where = jest.fn(async (..._a: unknown[]) => rows);
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where }) }) } }));

const isImpersonatedSession = jest.fn(async () => false);
const checkPermissionWithContext = jest.fn((..._a: unknown[]) => true);
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => checkPermissionWithContext(...a),
  isImpersonatedSession: () => isImpersonatedSession(),
}));
const logAuditEvent = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => logAuditEvent(...a) }));

import type { AuthContext } from "@/lib/auth-context";
import { monitorSecretNames, validateMonitorSecretRefs } from "./monitor-secret-refs";

const ctx = (over: Partial<AuthContext> = {}) =>
  ({ userId: "u", organizationId: "o", project: { id: "p" }, isCliAuth: false, ...over }) as unknown as AuthContext;

beforeEach(() => {
  isImpersonatedSession.mockResolvedValue(false);
  checkPermissionWithContext.mockReturnValue(true);
  logAuditEvent.mockClear();
  rows.length = 0;
  where.mockClear();
});

describe("monitorSecretNames", () => {
  it("collects both references and ignores everything else", () => {
    expect(monitorSecretNames({ aiEndpoint: { secretKey: "A" }, auth: { secretKey: "B" } })).toEqual(["A", "B"]);
    expect(monitorSecretNames({ aiEndpoint: { model: "m" }, auth: { type: "bearer", token: "t" } })).toEqual([]);
    expect(monitorSecretNames({ auth: { secretKey: "" } })).toEqual([]);
    expect(monitorSecretNames(null)).toEqual([]);
    expect(monitorSecretNames("x")).toEqual([]);
  });
});

describe("validateMonitorSecretRefs", () => {
  it("skips the lookup when no secret is named", async () => {
    expect(await validateMonitorSecretRefs(ctx(), { method: "GET" })).toEqual({ success: true });
    expect(where).not.toHaveBeenCalled();
  });
  it("succeeds when every distinct name is found, and names the first missing one otherwise", async () => {
    rows.push({ key: "A" }, { key: "B" });
    expect(await validateMonitorSecretRefs(ctx(), { aiEndpoint: { secretKey: "A" }, auth: { secretKey: "A" } })).toMatchObject({ success: true });
    expect(await validateMonitorSecretRefs(ctx(), { aiEndpoint: { secretKey: "A" }, auth: { secretKey: "C" } })).toEqual({
      success: false,
      error: "Invalid monitor configuration",
      details: "Secret C was not found in this project",
    });
  });

  const cfg = { aiEndpoint: { model: "m", secretKey: "A" } };
  it("returns the secret names and only the host of the target for the audit metadata", async () => {
    rows.push({ key: "A" });
    expect(await validateMonitorSecretRefs(ctx(), cfg, "https://api.example.com:8443/v1/chat?token=x")).toEqual({
      success: true,
      audit: { referencedSecrets: ["A"], targetHost: "api.example.com:8443" },
    });
  });
  it("is denied without variable:view_secrets, before any lookup", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    expect(await validateMonitorSecretRefs(ctx(), cfg)).toMatchObject({ success: false, status: 403 });
    expect(checkPermissionWithContext).toHaveBeenCalledWith("variable", "view_secrets", expect.anything());
    expect(where).not.toHaveBeenCalled();
  });
  it("is denied while impersonating, audited, but a CLI token is exempt", async () => {
    isImpersonatedSession.mockResolvedValue(true);
    expect(await validateMonitorSecretRefs(ctx(), cfg)).toMatchObject({ success: false, status: 403 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_secret_ref_impersonation_blocked", success: false }));
    rows.push({ key: "A" });
    expect(await validateMonitorSecretRefs(ctx({ isCliAuth: true }), cfg)).toMatchObject({ success: true });
  });
  it("does not check permission or impersonation when no secret is referenced", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    isImpersonatedSession.mockResolvedValue(true);
    expect(await validateMonitorSecretRefs(ctx(), { method: "GET" })).toEqual({ success: true });
  });
  it("gates a target change on a monitor that keeps a stored secret (no config sent)", async () => {
    const stored = { aiEndpoint: { model: "m", secretKey: "OPENAI_KEY" } };
    isImpersonatedSession.mockResolvedValue(true);
    expect(
      await validateMonitorSecretRefs(ctx(), undefined, "https://collector.example/v1", { storedConfig: stored, effectiveConfig: stored, targetChanged: true }),
    ).toMatchObject({ success: false, status: 403 });
    isImpersonatedSession.mockResolvedValue(false);
    checkPermissionWithContext.mockReturnValue(false);
    expect(
      await validateMonitorSecretRefs(ctx(), undefined, "https://collector.example/v1", { storedConfig: stored, effectiveConfig: stored, targetChanged: true }),
    ).toMatchObject({ success: false, status: 403 });
    checkPermissionWithContext.mockReturnValue(true);
    // Allowed: audited with the new host; a stored reference is not re-checked for existence.
    expect(
      await validateMonitorSecretRefs(ctx(), undefined, "https://collector.example/v1", { storedConfig: stored, effectiveConfig: stored, targetChanged: true }),
    ).toEqual({ success: true, audit: { referencedSecrets: ["OPENAI_KEY"], targetHost: "collector.example" } });
    expect(where).not.toHaveBeenCalled();
    // Unchanged target: a stored secret resent by a full-replace PUT neither gates nor is re-checked.
    isImpersonatedSession.mockResolvedValue(true);
    expect(
      await validateMonitorSecretRefs(ctx(), stored, "https://api.openai.com", { storedConfig: stored, effectiveConfig: stored, targetChanged: false }),
    ).toEqual({ success: true });
    // ...but a newly added secret on the same target is gated.
    const added = { auth: { type: "bearer", secretKey: "OTHER" }, ...stored };
    expect(
      await validateMonitorSecretRefs(ctx(), added, "https://api.openai.com", { storedConfig: stored, effectiveConfig: added, targetChanged: false }),
    ).toMatchObject({ success: false, status: 403 });
  });
});
