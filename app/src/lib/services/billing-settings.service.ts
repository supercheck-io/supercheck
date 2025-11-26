/**
 * Billing Settings Service
 * 
 * Manages organization billing settings including:
 * - Spending limits
 * - Notification preferences
 * - Usage thresholds
 */

import { db } from "@/utils/db";
import { billingSettings, type BillingSettings, type BillingSettingsInsert } from "@/db/schema";
import { eq } from "drizzle-orm";

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
      const [newSettings] = await db.insert(billingSettings).values({
        organizationId,
        enableSpendingLimit: false,
        hardStopOnLimit: false,
        notifyAt50Percent: false,
        notifyAt80Percent: true,
        notifyAt90Percent: true,
        notifyAt100Percent: true,
      }).returning();
      settings = newSettings;
    }

    return this.formatSettings(settings);
  }

  /**
   * Update billing settings for an organization
   */
  async updateSettings(
    organizationId: string,
    updates: BillingSettingsUpdate
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
      updateData.notificationEmails = JSON.stringify(updates.notificationEmails);
    }

    const [updated] = await db
      .update(billingSettings)
      .set(updateData)
      .where(eq(billingSettings.organizationId, organizationId))
      .returning();

    return this.formatSettings(updated);
  }

  /**
   * Set spending limit in dollars (converts to cents)
   */
  async setSpendingLimit(
    organizationId: string,
    limitDollars: number | null,
    hardStop: boolean = false
  ): Promise<BillingSettingsResponse> {
    const limitCents = limitDollars !== null ? Math.round(limitDollars * 100) : null;

    return this.updateSettings(organizationId, {
      monthlySpendingLimitCents: limitCents,
      enableSpendingLimit: limitCents !== null,
      hardStopOnLimit: hardStop,
    });
  }

  /**
   * Disable spending limit
   */
  async disableSpendingLimit(organizationId: string): Promise<BillingSettingsResponse> {
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
    }
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
  async resetNotificationsForPeriod(organizationId: string): Promise<void> {
    await db
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
    threshold: "50" | "80" | "90" | "100" | "spending_warning" | "spending_limit"
  ): Promise<void> {
    const settings = await db.query.billingSettings.findFirst({
      where: eq(billingSettings.organizationId, organizationId),
    });

    if (!settings) return;

    const sentThisPeriod: string[] = settings.notificationsSentThisPeriod
      ? JSON.parse(settings.notificationsSentThisPeriod)
      : [];

    if (!sentThisPeriod.includes(threshold)) {
      sentThisPeriod.push(threshold);
    }

    await db
      .update(billingSettings)
      .set({
        notificationsSentThisPeriod: JSON.stringify(sentThisPeriod),
        lastNotificationSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(billingSettings.organizationId, organizationId));
  }

  /**
   * Check if a notification has already been sent this period
   */
  async hasNotificationBeenSent(
    organizationId: string,
    threshold: "50" | "80" | "90" | "100" | "spending_warning" | "spending_limit"
  ): Promise<boolean> {
    const settings = await db.query.billingSettings.findFirst({
      where: eq(billingSettings.organizationId, organizationId),
    });

    if (!settings?.notificationsSentThisPeriod) return false;

    const sentThisPeriod: string[] = JSON.parse(settings.notificationsSentThisPeriod);
    return sentThisPeriod.includes(threshold);
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
      notificationEmails: settings.notificationEmails
        ? JSON.parse(settings.notificationEmails)
        : [],
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }
}

// Export singleton instance
export const billingSettingsService = new BillingSettingsService();
