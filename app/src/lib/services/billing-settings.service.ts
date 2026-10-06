/**
 * Billing Settings Service
 *
 * Manages organization billing settings including:
 * - Spending limits
 * - Notification preferences
 * - Usage thresholds
 */

import { db } from "@/utils/db";
import {
  billingSettings,
  organization,
  type BillingSettings,
  type BillingSettingsInsert,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { BillingSettingsValidationError } from "@/lib/billing-errors";

export interface BillingSettingsUpdate {
  monthlySpendingLimitCents?: number | null;
  enableSpendingLimit?: boolean;
  hardStopOnLimit?: boolean;
  notifyAt50Percent?: boolean;
  notifyAt80Percent?: boolean;
  notifyAt90Percent?: boolean;
  notifyAt100Percent?: boolean;
  notificationEmails?: string[];
}

export interface BillingSettingsResponse {
  id: string;
  organizationId: string;
  monthlySpendingLimitCents: number | null;
  monthlySpendingLimitDollars: number | null;
  enableSpendingLimit: boolean;
  hardStopOnLimit: boolean;
  notifyAt50Percent: boolean;
  notifyAt80Percent: boolean;
  notifyAt90Percent: boolean;
  notifyAt100Percent: boolean;
  notificationEmails: string[];
  createdAt: Date;
  updatedAt: Date;
}

type NotificationThreshold =
  | "50"
  | "80"
  | "90"
  | "100"
  | "spending_warning"
  | "spending_limit"
  | "spending_90";

type NotificationResource = "playwright" | "k6" | "ai" | "sre";

class BillingSettingsService {
  /**
   * Get billing settings for an organization
   * Creates default settings if none exist
   */
  async getSettings(organizationId: string): Promise<BillingSettingsResponse> {
    let settings = await db.query.billingSettings.findFirst({
      where: eq(billingSettings.organizationId, organizationId),
    });

    // Create default settings if none exist
    if (!settings) {
      const [newSettings] = await db
        .insert(billingSettings)
        .values({
          organizationId,
          enableSpendingLimit: false,
          hardStopOnLimit: false,
          notifyAt50Percent: false,
          notifyAt80Percent: true,
          notifyAt90Percent: true,
          notifyAt100Percent: true,
        })
        .onConflictDoNothing({ target: billingSettings.organizationId })
        .returning();
      settings = newSettings ?? await db.query.billingSettings.findFirst({
        where: eq(billingSettings.organizationId, organizationId),
      });
    }

    if (!settings) throw new Error("Billing settings are unavailable");
    return this.formatSettings(settings);
  }

  /**
   * Update billing settings for an organization
   */
  async updateSettings(
    organizationId: string,
    updates: BillingSettingsUpdate,
  ): Promise<BillingSettingsResponse> {
    // Ensure settings exist
    await this.getSettings(organizationId);

    // Prepare update data
    const updateData: Partial<BillingSettingsInsert> = {
      updatedAt: new Date(),
    };

    if (updates.monthlySpendingLimitCents !== undefined) {
      updateData.monthlySpendingLimitCents = updates.monthlySpendingLimitCents;
    }

    if (updates.enableSpendingLimit !== undefined) {
      updateData.enableSpendingLimit = updates.enableSpendingLimit;
    }

    if (updates.hardStopOnLimit !== undefined) {
      updateData.hardStopOnLimit = updates.hardStopOnLimit;
    }

    if (updates.notifyAt50Percent !== undefined) {
      updateData.notifyAt50Percent = updates.notifyAt50Percent;
    }

    if (updates.notifyAt80Percent !== undefined) {
      updateData.notifyAt80Percent = updates.notifyAt80Percent;
    }

    if (updates.notifyAt90Percent !== undefined) {
      updateData.notifyAt90Percent = updates.notifyAt90Percent;
    }

    if (updates.notifyAt100Percent !== undefined) {
      updateData.notifyAt100Percent = updates.notifyAt100Percent;
    }

    if (updates.notificationEmails !== undefined) {
      updateData.notificationEmails = updates.notificationEmails;
    }

    return db.transaction(async (tx) => {
      // Validate partial updates against the locked row, so concurrent saves
      // cannot leave a limit enabled with a null or nonpositive amount.
      const [current] = await tx.select().from(billingSettings)
        .where(eq(billingSettings.organizationId, organizationId)).for("update");
      if (!current) throw new Error("Billing settings are unavailable");
      const enabled = updates.enableSpendingLimit ?? current.enableSpendingLimit;
      const cents = updates.monthlySpendingLimitCents !== undefined
        ? updates.monthlySpendingLimitCents : current.monthlySpendingLimitCents;
      if (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > 2147483647)) {
        throw new BillingSettingsValidationError("Spending limits must be representable as whole cents");
      }
      if (enabled && (cents === null || cents <= 0)) {
        throw new BillingSettingsValidationError("A positive monthly spending limit is required when spending limits are enabled");
      }
      const [updated] = await tx.update(billingSettings).set(updateData)
        .where(eq(billingSettings.organizationId, organizationId)).returning();
      return this.formatSettings(updated);
    });
  }

  /**
   * Set spending limit in dollars (converts to cents)
   */
  async setSpendingLimit(
    organizationId: string,
    limitDollars: number | null,
    hardStop: boolean = false,
  ): Promise<BillingSettingsResponse> {
    const limitCents =
      limitDollars !== null ? Math.round(limitDollars * 100) : null;

    return this.updateSettings(organizationId, {
      monthlySpendingLimitCents: limitCents,
      enableSpendingLimit: limitCents !== null,
      hardStopOnLimit: hardStop,
    });
  }

  /**
   * Disable spending limit
   */
  async disableSpendingLimit(
    organizationId: string,
  ): Promise<BillingSettingsResponse> {
    return this.updateSettings(organizationId, {
      enableSpendingLimit: false,
      hardStopOnLimit: false,
    });
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(
    organizationId: string,
    preferences: {
      notifyAt50Percent?: boolean;
      notifyAt80Percent?: boolean;
      notifyAt90Percent?: boolean;
      notifyAt100Percent?: boolean;
      emails?: string[];
    },
  ): Promise<BillingSettingsResponse> {
    return this.updateSettings(organizationId, {
      notifyAt50Percent: preferences.notifyAt50Percent,
      notifyAt80Percent: preferences.notifyAt80Percent,
      notifyAt90Percent: preferences.notifyAt90Percent,
      notifyAt100Percent: preferences.notifyAt100Percent,
      notificationEmails: preferences.emails,
    });
  }

  /**
   * Reset notifications sent this period (called on billing period reset)
   */
  async resetNotificationsForPeriod(
    organizationId: string,
    database: Pick<typeof db, "update"> = db,
  ): Promise<void> {
    await database
      .update(billingSettings)
      .set({
        notificationsSentThisPeriod: null,
        updatedAt: new Date(),
      })
      .where(eq(billingSettings.organizationId, organizationId));
  }

  /**
   * Mark a notification threshold as sent
   */
  async markNotificationSent(
    organizationId: string,
    threshold: NotificationThreshold,
    resource?: NotificationResource,
    periodStart?: Date | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // Rollover holds this same lock. An email sent for the old period must
      // not suppress the new period's alert after the counter reset commits.
      const [org] = await tx.select({ usagePeriodStart: organization.usagePeriodStart })
        .from(organization).where(eq(organization.id, organizationId)).for("update");
      if (!org || (periodStart !== undefined &&
        org.usagePeriodStart?.getTime() !== periodStart?.getTime())) return;
      const settings = await tx.query.billingSettings.findFirst({
        where: eq(billingSettings.organizationId, organizationId),
      });
      if (!settings) return;

      // Positive keys identify quota/resource thresholds; negative keys identify
      // spending alerts. The lock also prevents concurrent keys being lost.
      const sentThisPeriod: number[] = settings.notificationsSentThisPeriod ?? [];
      const thresholdNum = this.getNotificationSentKey(threshold, resource);
      if (!sentThisPeriod.includes(thresholdNum)) sentThisPeriod.push(thresholdNum);
      await tx.update(billingSettings).set({
        notificationsSentThisPeriod: sentThisPeriod,
        lastNotificationSentAt: new Date(), updatedAt: new Date(),
      }).where(eq(billingSettings.organizationId, organizationId));
    });
  }

  /**
   * Check if a notification has already been sent this period.
   * De-duplicates by threshold and resource so one meter does not suppress
   * alerts for another meter in the same billing period.
   */
  async hasNotificationBeenSent(
    organizationId: string,
    threshold: NotificationThreshold,
    resource?: NotificationResource,
  ): Promise<boolean> {
    const settings = await db.query.billingSettings.findFirst({
      where: eq(billingSettings.organizationId, organizationId),
    });

    if (!settings) return false;

    if (!settings.notificationsSentThisPeriod) return false;

    // notificationsSentThisPeriod is now a jsonb array of numbers
    const sentThisPeriod: number[] = settings.notificationsSentThisPeriod;
    const thresholdNum = this.getNotificationSentKey(threshold, resource);
    return sentThisPeriod.includes(thresholdNum);
  }

  private getNotificationSentKey(
    threshold: NotificationThreshold,
    resource?: NotificationResource,
  ): number {
    if (threshold === "spending_warning") return -1;
    if (threshold === "spending_limit") return -2;
    if (threshold === "spending_90") return -3;

    const thresholdNum = parseInt(threshold, 10);
    if (resource === "k6") return 1000 + thresholdNum;
    if (resource === "ai") return 2000 + thresholdNum;
    if (resource === "sre") return 3000 + thresholdNum;
    return thresholdNum;
  }

  /**
   * Format settings for API response
   */
  private formatSettings(settings: BillingSettings): BillingSettingsResponse {
    return {
      id: settings.id,
      organizationId: settings.organizationId,
      monthlySpendingLimitCents: settings.monthlySpendingLimitCents,
      monthlySpendingLimitDollars: settings.monthlySpendingLimitCents
        ? settings.monthlySpendingLimitCents / 100
        : null,
      enableSpendingLimit: settings.enableSpendingLimit,
      hardStopOnLimit: settings.hardStopOnLimit,
      notifyAt50Percent: settings.notifyAt50Percent,
      notifyAt80Percent: settings.notifyAt80Percent,
      notifyAt90Percent: settings.notifyAt90Percent,
      notifyAt100Percent: settings.notifyAt100Percent,
      notificationEmails: settings.notificationEmails ?? [],
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }
}

// Export singleton instance
export const billingSettingsService = new BillingSettingsService();
