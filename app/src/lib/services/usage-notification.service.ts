/**
 * Usage Notification Service
 * 
 * Handles sending usage-related notifications to organization admins:
 * - Usage threshold alerts (50%, 80%, 90%, 100%)
 * - Spending limit warnings
 * - Billing period reset notifications
 */

import { db } from "@/utils/db";
import { 
  organization, 
  member, 
  usageNotifications
} from "@/db/schema";
import { user } from "@/db/schema/auth";
import { eq, and, inArray } from "drizzle-orm";
import { EmailService } from "@/lib/email-service";
import { renderUsageNotificationEmail } from "@/lib/email-renderer";
import { billingSettingsService } from "./billing-settings.service";
import { polarUsageService } from "./polar-usage.service";
import { isPolarEnabled } from "@/lib/feature-flags";

type NotificationType = 
  | "usage_50_percent"
  | "usage_80_percent"
  | "usage_90_percent"
  | "usage_100_percent"
  | "spending_limit_warning"
  | "spending_limit_reached";

type ResourceType = "playwright" | "k6" | "combined" | "spending";

interface NotificationResult {
  sent: boolean;
  notificationId?: string;
  error?: string;
  recipients?: string[];
}

class UsageNotificationService {
  private emailService = EmailService.getInstance();

  /**
   * Check and send usage notifications for an organization
   * Should be called after each usage update
   */
  async checkAndNotify(organizationId: string): Promise<NotificationResult[]> {
    if (!isPolarEnabled()) {
      return []; // No notifications in self-hosted mode
    }

    const results: NotificationResult[] = [];

    try {
      // Get organization details
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      });

      if (!org) {
        return [{ sent: false, error: "Organization not found" }];
      }

      // Get billing settings
      const settings = await billingSettingsService.getSettings(organizationId);

      // Get usage metrics
      const metrics = await polarUsageService.getUsageMetrics(organizationId);

      // Check Playwright usage thresholds
      const playwrightResult = await this.checkResourceThreshold(
        organizationId,
        org.name,
        "playwright",
        metrics.playwrightMinutes.used,
        metrics.playwrightMinutes.included,
        metrics.playwrightMinutes.percentage,
        settings,
        org.usagePeriodStart,
        org.usagePeriodEnd
      );
      if (playwrightResult) results.push(playwrightResult);

      // Check K6 usage thresholds
      const k6Result = await this.checkResourceThreshold(
        organizationId,
        org.name,
        "k6",
        metrics.k6VuHours.used,
        metrics.k6VuHours.included,
        metrics.k6VuHours.percentage,
        settings,
        org.usagePeriodStart,
        org.usagePeriodEnd
      );
      if (k6Result) results.push(k6Result);

      // Check spending limit
      if (settings.enableSpendingLimit && settings.monthlySpendingLimitCents) {
        const spendingResult = await this.checkSpendingThreshold(
          organizationId,
          org.name,
          metrics.totalOverageCostCents,
          settings.monthlySpendingLimitCents,
          settings,
          org.usagePeriodStart,
          org.usagePeriodEnd
        );
        if (spendingResult) results.push(spendingResult);
      }

      return results;
    } catch (error) {
      console.error("[UsageNotification] Error checking notifications:", error);
      return [{ sent: false, error: error instanceof Error ? error.message : "Unknown error" }];
    }
  }

  /**
   * Check resource usage threshold and send notification if needed
   */
  private async checkResourceThreshold(
    organizationId: string,
    organizationName: string,
    resourceType: "playwright" | "k6",
    used: number,
    limit: number,
    percentage: number,
    settings: Awaited<ReturnType<typeof billingSettingsService.getSettings>>,
    periodStart: Date | null,
    periodEnd: Date | null
  ): Promise<NotificationResult | null> {
    // Determine which threshold was crossed
    let notificationType: NotificationType | null = null;
    let thresholdKey: "50" | "80" | "90" | "100" | null = null;

    if (percentage >= 100 && settings.notifyAt100Percent) {
      notificationType = "usage_100_percent";
      thresholdKey = "100";
    } else if (percentage >= 90 && settings.notifyAt90Percent) {
      notificationType = "usage_90_percent";
      thresholdKey = "90";
    } else if (percentage >= 80 && settings.notifyAt80Percent) {
      notificationType = "usage_80_percent";
      thresholdKey = "80";
    } else if (percentage >= 50 && settings.notifyAt50Percent) {
      notificationType = "usage_50_percent";
      thresholdKey = "50";
    }

    if (!notificationType || !thresholdKey) {
      return null;
    }

    // Check if notification already sent this period
    const alreadySent = await billingSettingsService.hasNotificationBeenSent(
      organizationId,
      thresholdKey
    );

    if (alreadySent) {
      return null;
    }

    // Send notification
    return this.sendNotification(
      organizationId,
      organizationName,
      notificationType,
      resourceType,
      used,
      limit,
      percentage,
      periodStart,
      periodEnd,
      settings.notificationEmails
    );
  }

  /**
   * Check spending threshold and send notification if needed
   */
  private async checkSpendingThreshold(
    organizationId: string,
    organizationName: string,
    currentSpendingCents: number,
    limitCents: number,
    settings: Awaited<ReturnType<typeof billingSettingsService.getSettings>>,
    periodStart: Date | null,
    periodEnd: Date | null
  ): Promise<NotificationResult | null> {
    const percentage = Math.round((currentSpendingCents / limitCents) * 100);

    let notificationType: NotificationType | null = null;
    let thresholdKey: "spending_warning" | "spending_limit" | null = null;

    if (percentage >= 100) {
      notificationType = "spending_limit_reached";
      thresholdKey = "spending_limit";
    } else if (percentage >= 80) {
      notificationType = "spending_limit_warning";
      thresholdKey = "spending_warning";
    }

    if (!notificationType || !thresholdKey) {
      return null;
    }

    // Check if notification already sent this period
    const alreadySent = await billingSettingsService.hasNotificationBeenSent(
      organizationId,
      thresholdKey
    );

    if (alreadySent) {
      return null;
    }

    // Send notification
    return this.sendNotification(
      organizationId,
      organizationName,
      notificationType,
      "spending",
      currentSpendingCents / 100, // Convert to dollars for display
      limitCents / 100,
      percentage,
      periodStart,
      periodEnd,
      settings.notificationEmails,
      currentSpendingCents / 100,
      limitCents / 100
    );
  }

  /**
   * Send a usage notification email
   */
  private async sendNotification(
    organizationId: string,
    organizationName: string,
    notificationType: NotificationType,
    resourceType: ResourceType,
    usageAmount: number,
    usageLimit: number,
    usagePercentage: number,
    periodStart: Date | null,
    periodEnd: Date | null,
    customEmails: string[],
    currentSpendingDollars?: number,
    spendingLimitDollars?: number
  ): Promise<NotificationResult> {
    try {
      // Get recipients
      const recipients = await this.getNotificationRecipients(organizationId, customEmails);

      if (recipients.length === 0) {
        return { sent: false, error: "No recipients found" };
      }

      // Build billing page URL
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "";
      const billingPageUrl = `${baseUrl}/org-admin?tab=subscription`;

      // Format period end date
      const periodEndDate = periodEnd
        ? periodEnd.toLocaleDateString("en-US", { 
            year: "numeric", 
            month: "long", 
            day: "numeric" 
          })
        : "End of billing period";

      // Render email
      const emailContent = await renderUsageNotificationEmail({
        organizationName,
        notificationType,
        resourceType,
        usageAmount,
        usageLimit,
        usagePercentage,
        currentSpendingDollars,
        spendingLimitDollars,
        billingPageUrl,
        periodEndDate,
      });

      // Send to all recipients
      const sendResults = await Promise.all(
        recipients.map(async (email) => {
          const result = await this.emailService.sendEmail({
            to: email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });
          return { email, success: result.success, error: result.error };
        })
      );

      const successCount = sendResults.filter((r) => r.success).length;
      const failedEmails = sendResults.filter((r) => !r.success).map((r) => r.email);

      // Record notification in database
      const [notification] = await db.insert(usageNotifications).values({
        organizationId,
        notificationType,
        resourceType,
        usageAmount: usageAmount.toString(),
        usageLimit: usageLimit.toString(),
        usagePercentage,
        currentSpendingCents: currentSpendingDollars ? Math.round(currentSpendingDollars * 100) : null,
        spendingLimitCents: spendingLimitDollars ? Math.round(spendingLimitDollars * 100) : null,
        sentTo: JSON.stringify(recipients),
        deliveryStatus: successCount > 0 ? "sent" : "failed",
        deliveryError: failedEmails.length > 0 ? `Failed for: ${failedEmails.join(", ")}` : null,
        billingPeriodStart: periodStart || new Date(),
        billingPeriodEnd: periodEnd || new Date(),
        sentAt: new Date(),
      }).returning();

      // Mark notification as sent in billing settings
      const thresholdKey = this.getThresholdKey(notificationType);
      if (thresholdKey) {
        await billingSettingsService.markNotificationSent(organizationId, thresholdKey);
      }

      console.log(
        `[UsageNotification] Sent ${notificationType} notification to ${successCount}/${recipients.length} recipients for org ${organizationId}`
      );

      return {
        sent: successCount > 0,
        notificationId: notification.id,
        recipients,
        error: failedEmails.length > 0 ? `Failed for: ${failedEmails.join(", ")}` : undefined,
      };
    } catch (error) {
      console.error("[UsageNotification] Failed to send notification:", error);
      return {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get notification recipients for an organization
   */
  private async getNotificationRecipients(
    organizationId: string,
    customEmails: string[]
  ): Promise<string[]> {
    const recipients = new Set<string>();

    // Add custom emails if specified
    if (customEmails && customEmails.length > 0) {
      customEmails.forEach((email) => recipients.add(email));
    }

    // Always include org admins and owners
    const adminMembers = await db
      .select({
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(
          eq(member.organizationId, organizationId),
          inArray(member.role, ["org_owner", "org_admin"])
        )
      );

    adminMembers.forEach((m) => {
      if (m.email) recipients.add(m.email);
    });

    return Array.from(recipients);
  }

  /**
   * Get threshold key for tracking sent notifications
   */
  private getThresholdKey(
    notificationType: NotificationType
  ): "50" | "80" | "90" | "100" | "spending_warning" | "spending_limit" | null {
    if (notificationType === "spending_limit_warning") return "spending_warning";
    if (notificationType === "spending_limit_reached") return "spending_limit";

    const percentageMatch = notificationType.match(/usage_(\d+)_percent/);
    if (percentageMatch) {
      return percentageMatch[1] as "50" | "80" | "90" | "100";
    }

    return null;
  }

  /**
   * Get notification history for an organization
   */
  async getNotificationHistory(
    organizationId: string,
    options?: { limit?: number; offset?: number }
  ) {
    return db.query.usageNotifications.findMany({
      where: eq(usageNotifications.organizationId, organizationId),
      limit: options?.limit || 50,
      offset: options?.offset || 0,
      orderBy: (notifications, { desc }) => [desc(notifications.createdAt)],
    });
  }
}

// Export singleton instance
export const usageNotificationService = new UsageNotificationService();
