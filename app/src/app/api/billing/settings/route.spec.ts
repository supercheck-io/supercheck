jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: jest.fn(),
}));

jest.mock("@/lib/rbac/permissions", () => ({
  Role: {
    ORG_ADMIN: "org_admin",
    ORG_OWNER: "org_owner",
  },
}));

jest.mock("@/lib/services/billing-settings.service", () => ({
  billingSettingsService: {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  },
}));

jest.mock("@/lib/audit-log", () => ({
  auditBillingSettingsChange: jest.fn(() => Promise.resolve()),
}));

import { PATCH } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { NextRequest } from "next/server";

function settingsRequest(body: string, origin = "http://localhost:3000") {
  const request = new NextRequest("http://localhost:3000/api/billing/settings", {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body,
  });
  // JSDOM's Request body reader differs from the Node route runtime.
  request.json = async () => JSON.parse(body);
  return request;
}

describe("PATCH /api/billing/settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({
      userId: "user_123",
      organizationId: "org_123",
    });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (billingSettingsService.getSettings as jest.Mock).mockResolvedValue({
      monthlySpendingLimitDollars: null,
      enableSpendingLimit: false,
    });
  });

  it.each([0.001, 21474836.48])(
    "rejects an unrepresentable dollar limit: %s",
    async (amount) => {
      const response = await PATCH(settingsRequest(JSON.stringify({
          monthlySpendingLimitDollars: amount,
          enableSpendingLimit: true,
        })));
      expect(response.status).toBe(400);
      expect(billingSettingsService.updateSettings).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON as a client error", async () => {
    const response = await PATCH(settingsRequest("{invalid"));
    expect(response.status).toBe(400);
    expect(billingSettingsService.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects enabled spending limits without a positive cap", async () => {
    const response = await PATCH(settingsRequest(JSON.stringify({
        enableSpendingLimit: true,
        monthlySpendingLimitDollars: null,
        hardStopOnLimit: true,
      })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error:
          "A positive monthly spending limit is required when spending limits are enabled",
      }),
    );
    expect(billingSettingsService.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin billing change before authentication", async () => {
    const response = await PATCH(
      settingsRequest(JSON.stringify({ enableSpendingLimit: false }), "https://attacker.example"),
    );
    expect(response.status).toBe(403);
    expect(requireUserAuthContext).not.toHaveBeenCalled();
    expect(billingSettingsService.updateSettings).not.toHaveBeenCalled();
  });
});
