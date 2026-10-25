/** @jest-environment node */
const mockAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: () => mockAuth(),
  isAuthError: (error: unknown) =>
    error instanceof Error && error.name === "AuthError",
}));
const mockMetrics = jest.fn();
const mockSpending = jest.fn();
jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: {
    getUsageMetrics: (...a: unknown[]) => mockMetrics(...a),
    getSpendingStatus: (...a: unknown[]) => mockSpending(...a),
  },
}));
const mockHistory = jest.fn();
jest.mock("@/lib/services/usage-notification.service", () => ({
  usageNotificationService: {
    getNotificationHistory: (...a: unknown[]) => mockHistory(...a),
  },
}));
const mockRole = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: (...a: unknown[]) => mockRole(...a),
}));
jest.mock("@/lib/rbac/permissions", () => ({
  Role: { ORG_OWNER: "org_owner", ORG_ADMIN: "org_admin" },
}));

import { GET as usageGet } from "./usage/route";
import { GET as notificationsGet } from "./notifications/route";

const authError = () =>
  Object.assign(new Error("Authentication required"), { name: "AuthError" });
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockAuth.mockResolvedValue({
    userId: "u1",
    organizationId: "o1",
    isCliAuth: false,
  });
  mockRole.mockResolvedValue("org_admin");
});

describe("GET /api/billing/usage", () => {
  it.each(["project_admin", "project_editor", "project_viewer", null])(
    "refuses a member with role %s without reading usage",
    async (role) => {
      mockRole.mockResolvedValue(role);
      const response = await usageGet();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Insufficient permissions" });
      expect(mockMetrics).not.toHaveBeenCalled();
      expect(mockSpending).not.toHaveBeenCalled();
    },
  );
  it.each(["org_admin", "org_owner"])("serves usage to an %s", async (role) => {
    mockRole.mockResolvedValue(role);
    mockMetrics.mockResolvedValue({ playwrightMinutes: { used: 1 } });
    mockSpending.mockResolvedValue({ currentSpendingCents: 0, limitCents: null });
    expect((await usageGet()).status).toBe(200);
    expect(mockRole).toHaveBeenCalledWith("u1", "o1");
  });
  it("rejects CLI tokens", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: "o1",
      isCliAuth: true,
    });
    expect((await usageGet()).status).toBe(403);
    expect(mockMetrics).not.toHaveBeenCalled();
  });
  it("requires an active organization", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: null,
      isCliAuth: false,
    });
    expect((await usageGet()).status).toBe(400);
  });
  it("maps authentication failures to 401", async () => {
    mockAuth.mockRejectedValue(authError());
    expect((await usageGet()).status).toBe(401);
  });
  it("converts spending cents to dollars and keeps an unlimited limit null", async () => {
    mockMetrics.mockResolvedValue({ playwrightMinutes: { used: 1 } });
    mockSpending.mockResolvedValue({
      currentSpendingCents: 1250,
      limitCents: null,
      limitEnabled: false,
      hardStopEnabled: false,
      percentageUsed: 0,
      isAtLimit: false,
      remainingCents: null,
    });
    const body = await (await usageGet()).json();
    expect(mockMetrics).toHaveBeenCalledWith("o1");
    expect(body.spending).toMatchObject({
      currentDollars: 12.5,
      limitDollars: null,
      remainingDollars: null,
    });
  });
  it("converts a configured limit", async () => {
    mockMetrics.mockResolvedValue({});
    mockSpending.mockResolvedValue({
      currentSpendingCents: 500,
      limitCents: 2000,
      limitEnabled: true,
      hardStopEnabled: true,
      percentageUsed: 25,
      isAtLimit: false,
      remainingCents: 1500,
    });
    const body = await (await usageGet()).json();
    expect(body.spending).toMatchObject({
      limitDollars: 20,
      remainingDollars: 15,
      hardStopEnabled: true,
    });
  });
  it("returns 500 without leaking internals on service failure", async () => {
    mockMetrics.mockRejectedValue(new Error("db password leaked"));
    const response = await usageGet();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });
});

describe("GET /api/billing/notifications", () => {
  const call = (query = "") =>
    notificationsGet(
      new Request(`http://localhost/api/billing/notifications${query}`),
    );
  it("rejects CLI tokens and members below admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: "o1",
      isCliAuth: true,
    });
    expect((await call()).status).toBe(403);
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: "o1",
      isCliAuth: false,
    });
    mockRole.mockResolvedValue("project_editor");
    expect((await call()).status).toBe(403);
    expect(mockHistory).not.toHaveBeenCalled();
  });
  it("requires an organization and maps authentication failures", async () => {
    mockAuth.mockResolvedValue({
      userId: "u1",
      organizationId: null,
      isCliAuth: false,
    });
    expect((await call()).status).toBe(400);
    mockAuth.mockRejectedValue(authError());
    expect((await call()).status).toBe(401);
  });
  it.each(["org_owner", "org_admin"])(
    "allows %s and scopes history to the active organization",
    async (role) => {
      mockRole.mockResolvedValue(role);
      mockHistory.mockResolvedValue([{ id: 1 }]);
      const body = await (await call()).json();
      expect(mockHistory).toHaveBeenCalledWith("o1", { limit: 50, offset: 0 });
      expect(body.pagination).toEqual({ limit: 50, offset: 0, hasMore: false });
    },
  );
  it.each([
    ["?limit=1000", 100, 0],
    ["?limit=0", 1, 0],
    ["?limit=-5", 1, 0],
    ["?limit=abc&offset=abc", 50, 0],
    ["?offset=-9", 50, 0],
    ["?limit=10&offset=30", 10, 30],
  ])("clamps %s", async (query, limit, offset) => {
    mockRole.mockResolvedValue("org_owner");
    mockHistory.mockResolvedValue([]);
    await call(query);
    expect(mockHistory).toHaveBeenCalledWith("o1", { limit, offset });
  });
  it("reports hasMore when a full page is returned", async () => {
    mockRole.mockResolvedValue("org_owner");
    mockHistory.mockResolvedValue([{}, {}]);
    expect((await (await call("?limit=2")).json()).pagination.hasMore).toBe(
      true,
    );
  });
  it("returns 500 on service failure", async () => {
    mockRole.mockResolvedValue("org_owner");
    mockHistory.mockRejectedValue(new Error("x"));
    expect((await call()).status).toBe(500);
  });
});
