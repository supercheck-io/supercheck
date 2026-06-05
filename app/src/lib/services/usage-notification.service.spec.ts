jest.mock("@/utils/db", () => ({
  db: {
    query: {
      organization: { findFirst: jest.fn() },
      usageNotifications: { findMany: jest.fn() },
    },
    insert: jest.fn(),
    select: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  organization: { id: "organization.id" },
  member: {
    organizationId: "member.organizationId",
    userId: "member.userId",
    role: "member.role",
  },
  usageNotifications: {
    organizationId: "usageNotifications.organizationId",
    createdAt: "usageNotifications.createdAt",
  },
}));

jest.mock("@/db/schema/auth", () => ({
  user: {
    id: "user.id",
    email: "user.email",
  },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
  and: jest.fn((...conditions) => ({ op: "and", conditions })),
  inArray: jest.fn((field, values) => ({ op: "inArray", field, values })),
}));

jest.mock("@/lib/email-service", () => ({
  EmailService: {
    getInstance: jest.fn(() => ({
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    })),
  },
}));

jest.mock("@/lib/email-renderer", () => ({
  renderUsageNotificationEmail: jest.fn().mockResolvedValue({
    subject: "Usage alert",
    html: "<p>Usage alert</p>",
    text: "Usage alert",
  }),
}));

jest.mock("./billing-settings.service", () => ({
  billingSettingsService: {
    getSettings: jest.fn(),
    hasNotificationBeenSent: jest.fn(),
    markNotificationSent: jest.fn(),
  },
}));

jest.mock("./polar-usage.service", () => ({
  polarUsageService: {
    getUsageMetrics: jest.fn(),
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
}));

import { db } from "@/utils/db";
import { billingSettingsService } from "./billing-settings.service";
import { polarUsageService } from "./polar-usage.service";
import { usageNotificationService } from "./usage-notification.service";

describe("UsageNotificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
      id: "org_123",
      name: "Test Org",
      usagePeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      usagePeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
    });

    const returning = jest.fn().mockResolvedValue([{ id: "notif_123" }]);
    const values = jest.fn().mockReturnValue({ returning });
    (db.insert as jest.Mock).mockReturnValue({ values });

    const where = jest.fn().mockResolvedValue([{ email: "admin@example.com" }]);
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });
    (db.select as jest.Mock).mockReturnValue({ from });

    (billingSettingsService.getSettings as jest.Mock).mockResolvedValue({
      enableSpendingLimit: true,
      monthlySpendingLimitCents: 10_000,
      hardStopOnLimit: true,
      notifyAt50Percent: false,
      notifyAt80Percent: false,
      notifyAt90Percent: false,
      notifyAt100Percent: false,
      notificationEmails: [],
    });
    (billingSettingsService.hasNotificationBeenSent as jest.Mock).mockResolvedValue(false);
    (billingSettingsService.markNotificationSent as jest.Mock).mockResolvedValue(undefined);

    (polarUsageService.getUsageMetrics as jest.Mock).mockResolvedValue({
      playwrightMinutes: {
        used: 0,
        included: 100,
        overage: 0,
        overageCostCents: 0,
        percentage: 0,
      },
      k6VuMinutes: {
        used: 0,
        included: 100,
        overage: 0,
        overageCostCents: 0,
        percentage: 0,
      },
      aiCredits: {
        used: 0,
        included: 100,
        overage: 0,
        overageCostCents: 0,
        percentage: 0,
      },
      totalOverageCostCents: 9_000,
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("marks hard-stop 90% spending warnings with the checked key", async () => {
    await usageNotificationService.checkAndNotify("org_123");

    expect(billingSettingsService.hasNotificationBeenSent).toHaveBeenCalledWith(
      "org_123",
      "spending_90"
    );
    expect(billingSettingsService.markNotificationSent).toHaveBeenCalledWith(
      "org_123",
      "spending_90",
      undefined
    );
  });
});
