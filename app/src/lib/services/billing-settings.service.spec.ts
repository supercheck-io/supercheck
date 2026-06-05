jest.mock("@/utils/db", () => ({
  db: {
    query: {
      billingSettings: { findFirst: jest.fn() },
    },
    update: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  billingSettings: {
    organizationId: "billingSettings.organizationId",
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
}));

import { db } from "@/utils/db";
import { billingSettingsService } from "./billing-settings.service";

describe("BillingSettingsService notification keys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps legacy Playwright threshold keys readable", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [80],
      lastNotificationSentAt: null,
    });

    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "playwright")
    ).resolves.toBe(true);
  });

  it("does not let a Playwright threshold suppress K6 or AI alerts", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [80],
      lastNotificationSentAt: null,
    });

    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "k6")
    ).resolves.toBe(false);
    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "ai")
    ).resolves.toBe(false);
  });

  it("stores resource-qualified threshold keys", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [],
    });

    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    (db.update as jest.Mock).mockReturnValue({ set });

    await billingSettingsService.markNotificationSent("org_123", "90", "k6");

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationsSentThisPeriod: [1090],
      })
    );
  });
});
