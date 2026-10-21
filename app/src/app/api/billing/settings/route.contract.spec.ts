/** @jest-environment node */
const mockAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: () => mockAuth(),
  isAuthError: (e: unknown) => e instanceof Error && e.name === "AuthError",
}));
const mockRole = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: (...a: unknown[]) => mockRole(...a),
}));
jest.mock("@/lib/rbac/permissions", () => ({
  Role: { ORG_ADMIN: "org_admin", ORG_OWNER: "org_owner" },
}));
const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/services/billing-settings.service", () => ({
  billingSettingsService: {
    getSettings: (...a: unknown[]) => mockGet(...a),
    updateSettings: (...a: unknown[]) => mockUpdate(...a),
  },
}));
const mockAudit = jest.fn();
jest.mock("@/lib/audit-log", () => ({
  auditBillingSettingsChange: (...a: unknown[]) => mockAudit(...a),
}));

import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

const ORG = "0198a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
function patch(body: unknown, origin = "http://localhost:3000") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const request = new NextRequest(
    "http://localhost:3000/api/billing/settings",
    {
      method: "PATCH",
      headers: { origin, "content-type": "application/json" },
      body: text,
    },
  );
  request.json = async () => JSON.parse(text);
  return request;
}
const authError = () =>
  Object.assign(new Error("Authentication required"), { name: "AuthError" });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockAuth.mockResolvedValue({
    userId: "u1",
    organizationId: ORG,
    isCliAuth: false,
  });
  mockRole.mockResolvedValue("org_owner");
  mockGet.mockResolvedValue({
    monthlySpendingLimitDollars: null,
    enableSpendingLimit: false,
  });
  mockUpdate.mockResolvedValue({ enableSpendingLimit: true });
  mockAudit.mockResolvedValue(undefined);
});

describe("GET /api/billing/settings", () => {
  it("returns settings to org owners and admins only", async () => {
    mockGet.mockResolvedValue({ enableSpendingLimit: true });
    for (const role of ["org_owner", "org_admin"]) {
      mockRole.mockResolvedValue(role);
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ enableSpendingLimit: true });
    }
    mockRole.mockResolvedValue("project_editor");
    expect((await GET()).status).toBe(403);
  });
  it("rejects CLI tokens, missing organizations and unauthenticated callers", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: ORG,
      isCliAuth: true,
    });
    expect((await GET()).status).toBe(403);
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: null,
      isCliAuth: false,
    });
    expect((await GET()).status).toBe(400);
    mockAuth.mockRejectedValue(authError());
    expect((await GET()).status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });
  it("returns 500 without details on failure", async () => {
    mockGet.mockRejectedValue(new Error("secret db detail"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("PATCH /api/billing/settings", () => {
  it("rejects cross-origin writes before reading anything", async () => {
    expect(
      (await PATCH(patch({ hardStopOnLimit: true }, "https://evil.example")))
        .status,
    ).toBe(403);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("rejects CLI tokens, missing organizations, non-admins and unauthenticated callers", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: ORG,
      isCliAuth: true,
    });
    expect((await PATCH(patch({}))).status).toBe(403);
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: null,
      isCliAuth: false,
    });
    expect((await PATCH(patch({}))).status).toBe(400);
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: ORG,
      isCliAuth: false,
    });
    mockRole.mockResolvedValue("project_admin");
    expect((await PATCH(patch({ hardStopOnLimit: false }))).status).toBe(403);
    mockAuth.mockRejectedValue(authError());
    expect((await PATCH(patch({}))).status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("refuses to save for a different organization than the active one", async () => {
    const response = await PATCH(
      patch({
        organizationId: "0198a1b2-c3d4-7e5f-8a6b-000000000000",
        hardStopOnLimit: true,
      }),
    );
    expect(response.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ["a negative limit", { monthlySpendingLimitDollars: -1 }],
    ["a limit above the maximum", { monthlySpendingLimitDollars: 21474836.48 }],
    ["a sub-cent limit", { monthlySpendingLimitDollars: 10.005 }],
    ["a non-finite limit", { monthlySpendingLimitDollars: "NaN" }],
    ["a string limit", { monthlySpendingLimitDollars: "50" }],
    ["a non-boolean toggle", { enableSpendingLimit: "yes" }],
    [
      "too many notification emails",
      {
        notificationEmails: Array.from(
          { length: 11 },
          (_, i) => `a${i}@example.com`,
        ),
      },
    ],
    ["an invalid notification email", { notificationEmails: ["not-an-email"] }],
    [
      "an over-long notification email",
      { notificationEmails: [`${"a".repeat(250)}@example.com`] },
    ],
    ["a non-uuid organization id", { organizationId: "org_1" }],
    ["an array body", []],
    ["a null body", null],
  ])("rejects %s with 400", async (_name, body) => {
    expect((await PATCH(patch(body))).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON", async () => {
    expect((await PATCH(patch("{broken"))).status).toBe(400);
  });
  it("requires a positive limit whenever limits are enabled", async () => {
    expect((await PATCH(patch({ enableSpendingLimit: true }))).status).toBe(
      400,
    );
    expect(
      (
        await PATCH(
          patch({ enableSpendingLimit: true, monthlySpendingLimitDollars: 0 }),
        )
      ).status,
    ).toBe(400);
    mockGet.mockResolvedValue({
      monthlySpendingLimitDollars: 25,
      enableSpendingLimit: true,
    });
    expect(
      (await PATCH(patch({ monthlySpendingLimitDollars: null }))).status,
    ).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("converts dollars to whole cents without float drift and passes only provided fields", async () => {
    const response = await PATCH(
      patch({ enableSpendingLimit: true, monthlySpendingLimitDollars: 19.99 }),
    );
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(ORG, {
      enableSpendingLimit: true,
      monthlySpendingLimitCents: 1999,
    });
  });
  it("allows turning limits off and clearing the limit", async () => {
    await PATCH(
      patch({ enableSpendingLimit: false, monthlySpendingLimitDollars: null }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(ORG, {
      enableSpendingLimit: false,
      monthlySpendingLimitCents: null,
    });
  });
  it("normalises and de-duplicates notification emails", async () => {
    await PATCH(
      patch({
        notificationEmails: [
          " A@Example.com ",
          "a@example.com",
          "b@example.com",
        ],
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(ORG, {
      notificationEmails: ["a@example.com", "b@example.com"],
    });
  });
  it("audits the change but never fails the request when the audit write fails", async () => {
    mockAudit.mockRejectedValue(new Error("audit down"));
    const response = await PATCH(patch({ hardStopOnLimit: true }));
    expect(response.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(
      ORG,
      "u1",
      expect.anything(),
      expect.anything(),
    );
  });
  it("returns 500 without details on unexpected failure", async () => {
    mockUpdate.mockRejectedValue(new Error("secret db detail"));
    const response = await PATCH(patch({ hardStopOnLimit: true }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
