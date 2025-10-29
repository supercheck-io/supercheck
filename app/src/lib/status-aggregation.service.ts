import { db } from "@/utils/db";
import { statusPageComponents } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

export type AggregationMethod =
  | "worst_case"
  | "best_case"
  | "weighted_average"
  | "majority_vote";

interface MonitorStatusData {
  status: ComponentStatus;
  weight: number;
}

export class StatusAggregationService {
  /**
   * Calculate the aggregated status for a component based on its monitors
   */
  async calculateComponentStatus(
    componentId: string
  ): Promise<ComponentStatus> {
    const component = await db.query.statusPageComponents.findFirst({
      where: eq(statusPageComponents.id, componentId),
      with: {
        monitors: {
          with: {
            monitor: true,
          },
        },
      },
    });

    if (!component || component.monitors.length === 0) {
      return "operational";
    }

    const monitorStatuses: MonitorStatusData[] = component.monitors.map(
      (ma) => ({
        status: this.mapMonitorStatus(ma.monitor.status),
        weight: ma.weight,
      })
    );

    return this.aggregateStatuses(
      monitorStatuses,
      component.aggregationMethod as AggregationMethod
    );
  }

  /**
   * Aggregate multiple monitor statuses into a single component status
   */
  private aggregateStatuses(
    statuses: MonitorStatusData[],
    method: AggregationMethod
  ): ComponentStatus {
    switch (method) {
      case "worst_case":
        return this.getWorstStatus(statuses.map((s) => s.status));

      case "best_case":
        return this.getBestStatus(statuses.map((s) => s.status));

      case "weighted_average":
        return this.getWeightedStatus(statuses);

      case "majority_vote":
        return this.getMajorityStatus(statuses.map((s) => s.status));

      default:
        return this.getWorstStatus(statuses.map((s) => s.status));
    }
  }

  /**
   * Get the worst status from a list of statuses
   */
  private getWorstStatus(statuses: ComponentStatus[]): ComponentStatus {
    const statusHierarchy: ComponentStatus[] = [
      "major_outage",
      "partial_outage",
      "degraded_performance",
      "under_maintenance",
      "operational",
    ];

    for (const status of statusHierarchy) {
      if (statuses.includes(status)) {
        return status;
      }
    }

    return "operational";
  }

  /**
   * Get the best status from a list of statuses
   */
  private getBestStatus(statuses: ComponentStatus[]): ComponentStatus {
    const statusHierarchy: ComponentStatus[] = [
      "operational",
      "under_maintenance",
      "degraded_performance",
      "partial_outage",
      "major_outage",
    ];

    for (const status of statusHierarchy) {
      if (statuses.includes(status)) {
        return status;
      }
    }

    return "operational";
  }

  /**
   * Get weighted status based on monitor weights
   */
  private getWeightedStatus(statuses: MonitorStatusData[]): ComponentStatus {
    // Count weighted status values
    const statusWeights: Record<ComponentStatus, number> = {
      operational: 0,
      degraded_performance: 0,
      partial_outage: 0,
      major_outage: 0,
      under_maintenance: 0,
    };

    let totalWeight = 0;

    for (const { status, weight } of statuses) {
      statusWeights[status] += weight;
      totalWeight += weight;
    }

    // If no weights, return operational
    if (totalWeight === 0) {
      return "operational";
    }

    // Calculate percentages
    const statusPercentages: Record<ComponentStatus, number> = {
      operational: (statusWeights.operational / totalWeight) * 100,
      degraded_performance:
        (statusWeights.degraded_performance / totalWeight) * 100,
      partial_outage: (statusWeights.partial_outage / totalWeight) * 100,
      major_outage: (statusWeights.major_outage / totalWeight) * 100,
      under_maintenance: (statusWeights.under_maintenance / totalWeight) * 100,
    };

    // Return status based on weighted percentages
    if (statusPercentages.major_outage >= 50) return "major_outage";
    if (statusPercentages.partial_outage >= 50) return "partial_outage";
    if (statusPercentages.degraded_performance >= 50)
      return "degraded_performance";
    if (statusPercentages.under_maintenance >= 50) return "under_maintenance";

    return "operational";
  }

  /**
   * Get majority vote status
   */
  private getMajorityStatus(statuses: ComponentStatus[]): ComponentStatus {
    const statusCounts: Record<ComponentStatus, number> = {
      operational: 0,
      degraded_performance: 0,
      partial_outage: 0,
      major_outage: 0,
      under_maintenance: 0,
    };

    // Count occurrences
    for (const status of statuses) {
      statusCounts[status]++;
    }

    // Find the status with the highest count
    let maxCount = 0;
    let majorityStatus: ComponentStatus = "operational";

    for (const [status, count] of Object.entries(statusCounts)) {
      if (count > maxCount) {
        maxCount = count;
        majorityStatus = status as ComponentStatus;
      }
    }

    return majorityStatus;
  }

  /**
   * Map monitor status to component status
   */
  private mapMonitorStatus(monitorStatus: string): ComponentStatus {
    const mapping: Record<string, ComponentStatus> = {
      up: "operational",
      down: "major_outage",
      error: "major_outage",
      timeout: "major_outage",
      paused: "under_maintenance",
      pending: "degraded_performance",
      maintenance: "under_maintenance",
    };

    return mapping[monitorStatus] || "operational";
  }

  /**
   * Update component status based on monitor changes
   */
  async updateComponentStatus(componentId: string): Promise<void> {
    const newStatus = await this.calculateComponentStatus(componentId);

    await db
      .update(statusPageComponents)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(statusPageComponents.id, componentId));
  }

  /**
   * Batch update status for multiple components
   */
  async updateMultipleComponentStatuses(componentIds: string[]): Promise<void> {
    for (const componentId of componentIds) {
      await this.updateComponentStatus(componentId);
    }
  }
}

// Export singleton instance
export const statusAggregationService = new StatusAggregationService();
