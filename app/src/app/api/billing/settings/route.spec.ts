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

  it("rejects enabled spending limits without a positive cap", async () => {
    const response = await PATCH({
      json: async () => ({
          enableSpendingLimit: true,
          monthlySpendingLimitDollars: null,
          hardStopOnLimit: true,
        }),
    } as Request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error:
          "A positive monthly spending limit is required when spending limits are enabled",
      })
    );
    expect(billingSettingsService.updateSettings).not.toHaveBeenCalled();
  });
});
