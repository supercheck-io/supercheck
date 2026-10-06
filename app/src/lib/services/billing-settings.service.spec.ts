jest.mock("@/utils/db", () => ({
  db: {
    query: {
      billingSettings: { findFirst: jest.fn() },
    },
    update: jest.fn(),
    insert: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  billingSettings: {
    organizationId: "billingSettings.organizationId",
  },
  organization: { id: "organization.id", usagePeriodStart: "organization.usagePeriodStart" },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
}));

import { db } from "@/utils/db";
import { billingSettingsService } from "./billing-settings.service";

describe("BillingSettingsService notification keys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ usagePeriodStart: null }] }) }) }),
      query: db.query, update: db.update,
    }));
  });

  it("does not mark an old email threshold in the new billing period", async () => {
    const oldPeriod = new Date("2026-09-01T00:00:00Z");
    const locked = jest.fn().mockResolvedValue([{ usagePeriodStart: new Date("2026-10-01T00:00:00Z") }]);
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: locked }) }) }),
      query: db.query, update: db.update,
    }));
    await billingSettingsService.markNotificationSent("org_123", "80", "ai", oldPeriod);
    expect(locked).toHaveBeenCalledWith("update");
    expect(db.query.billingSettings.findFirst).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("uses the existing settings when concurrent creation wins the insert", async () => {
    const existing = {
      id: "settings_123", organizationId: "org_123",
      enableSpendingLimit: true, monthlySpendingLimitCents: 1234,
      hardStopOnLimit: true,
    };
    (db.query.billingSettings.findFirst as jest.Mock)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(existing);
    const returning = jest.fn().mockResolvedValue([]);
    const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
    (db.insert as jest.Mock).mockReturnValue({
      values: jest.fn().mockReturnValue({ onConflictDoNothing }),
    });
    await expect(billingSettingsService.getSettings("org_123")).resolves.toMatchObject({
      enableSpendingLimit: true, monthlySpendingLimitDollars: 12.34, hardStopOnLimit: true,
    });
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: "billingSettings.organizationId" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("keeps legacy Playwright threshold keys readable", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [80],
      lastNotificationSentAt: null,
    });

    await expect(
      billingSettingsService.hasNotificationBeenSent(
        "org_123",
        "80",
        "playwright",
      ),
    ).resolves.toBe(true);
  });

  it.each([
    { current: { enableSpendingLimit: true, monthlySpendingLimitCents: 1000 }, updates: { monthlySpendingLimitCents: null } },
    { current: { enableSpendingLimit: false, monthlySpendingLimitCents: null }, updates: { enableSpendingLimit: true } },
  ])("rejects invalid partial saves after a concurrent change", async ({ current, updates }) => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      enableSpendingLimit: false, monthlySpendingLimitCents: 1000,
    });
    const locked = jest.fn().mockResolvedValue([current]);
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: locked }) }) }),
      update: jest.fn(),
    };
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback(tx));
    await expect(billingSettingsService.updateSettings("org_123", updates)).rejects.toThrow("positive monthly spending limit");
    expect(locked).toHaveBeenCalledWith("update");
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("saves a valid cap and alert preferences together under the row lock", async () => {
    const current = { enableSpendingLimit: false, monthlySpendingLimitCents: null };
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue(current);
    const returning = jest.fn().mockResolvedValue([{ ...current, enableSpendingLimit: true, monthlySpendingLimitCents: 1234 }]);
    const set = jest.fn(() => ({ where: () => ({ returning }) }));
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [current] }) }) }),
      update: () => ({ set }),
    }));
    await expect(billingSettingsService.updateSettings("org_123", {
      enableSpendingLimit: true, monthlySpendingLimitCents: 1234, notifyAt50Percent: true,
    })).resolves.toMatchObject({ monthlySpendingLimitDollars: 12.34, enableSpendingLimit: true });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ notifyAt50Percent: true }));
  });

  it("does not let a Playwright threshold suppress K6, AI or SRE alerts", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [80],
      lastNotificationSentAt: null,
    });

    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "k6"),
    ).resolves.toBe(false);
    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "ai"),
    ).resolves.toBe(false);
    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "80", "sre"),
    ).resolves.toBe(false);
  });

  it("deduplicates SRE alerts independently of Playwright", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [3090],
    });
    await expect(
      billingSettingsService.hasNotificationBeenSent("org_123", "90", "sre"),
    ).resolves.toBe(true);
    await expect(
      billingSettingsService.hasNotificationBeenSent(
        "org_123",
        "90",
        "playwright",
      ),
    ).resolves.toBe(false);
  });

  it("stores resource-qualified threshold keys", async () => {
    (db.query.billingSettings.findFirst as jest.Mock).mockResolvedValue({
      notificationsSentThisPeriod: [],
    });

    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    (db.update as jest.Mock).mockReturnValue({ set });
    const periodStart = new Date("2026-10-01T00:00:00Z");
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [{ usagePeriodStart: periodStart }] }) }) }),
      query: db.query, update: db.update,
    }));
    await billingSettingsService.markNotificationSent("org_123", "90", "k6", periodStart);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationsSentThisPeriod: [1090],
      }),
    );
  });
});
