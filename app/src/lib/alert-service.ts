import { db } from "@/utils/db";
import {
  alerts,
  Alert,
  alertHistory,
  AlertType,
  AlertStatus,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export class AlertService {
  private static instance: AlertService;

  public static getInstance(): AlertService {
    if (!AlertService.instance) {
      AlertService.instance = new AlertService();
    }
    return AlertService.instance;
  }

  /**
   * Save alert notification to history
   */
  async saveAlertHistory(alertData: {
    type: AlertType;
    message: string;
    target: string;
    targetType: "monitor" | "job";
    monitorId?: string;
    jobId?: string;
    providerId: string;
    status: AlertStatus;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await db.insert(alertHistory).values({
        type: alertData.type,
        message: alertData.message,
        target: alertData.target,
        targetType: alertData.targetType,
        monitorId: alertData.monitorId || null,
        jobId: alertData.jobId || null,
        provider: alertData.providerId,
        status: alertData.status,
        errorMessage: alertData.errorMessage || null,
        sentAt: new Date(),
      });

      console.log(
        `Alert history saved: ${alertData.type} for ${alertData.target}`
      );
    } catch (error) {
      console.error("Failed to save alert history:", error);
    }
  }

  /**
   * Get an alert by its ID.
   * @param alertId - The ID of the alert to retrieve.
   * @returns The alert object or null if not found.
   */
  async getAlertById(alertId: string) {
    try {
      const alert = await db.query.alerts.findFirst({
        where: eq(alerts.id, alertId),
        with: {},
      });
      return alert;
    } catch (error) {
      console.error("Failed to get alert:", error);
      return null;
    }
  }

  /**
   * Create a new alert.
   * @param alertData - The data for the new alert.
   * @returns The newly created alert.
   */
  async createAlert(alertData: Omit<Alert, "id" | "createdAt" | "updatedAt">) {
    try {
      const newAlert = await db.insert(alerts).values(alertData).returning();
      return newAlert[0];
    } catch (error) {
      console.error("Error creating alert:", error);
      throw new Error("Could not create alert.");
    }
  }

  /**
   * Update an existing alert.
   * @param alertId - The ID of the alert to update.
   * @param alertData - The new data for the alert.
   * @returns The updated alert.
   */
  async updateAlert(alertId: string, alertData: Partial<Alert>) {
    try {
      const updatedAlert = await db
        .update(alerts)
        .set(alertData)
        .where(eq(alerts.id, alertId))
        .returning();

      if (updatedAlert.length === 0) {
        throw new Error("Alert not found");
      }

      return updatedAlert[0];
    } catch (error) {
      console.error(`Error updating alert ${alertId}:`, error);
      throw new Error("Could not update alert.");
    }
  }

  /**
   * Delete an alert.
   * @param alertId - The ID of the alert to delete.
   */
  async deleteAlert(alertId: string) {
    try {
      await db.delete(alerts).where(eq(alerts.id, alertId));
      console.log(`Alert ${alertId} deleted successfully.`);
    } catch (error) {
      console.error(`Error deleting alert ${alertId}:`, error);
      throw new Error("Could not delete alert.");
    }
  }

  /**
   * Get all alerts for a given monitor.
   * @param monitorId - The ID of the monitor.
   * @returns A list of alerts for the monitor.
   */
  async getAlertsForMonitor(monitorId: string) {
    try {
      const monitorAlerts = await db.query.alerts.findMany({
        where: eq(alerts.monitorId, monitorId),
        with: {},
      });
      return monitorAlerts;
    } catch (error) {
      console.error("Failed to get alerts for monitor:", error);
      return [];
    }
  }
}
