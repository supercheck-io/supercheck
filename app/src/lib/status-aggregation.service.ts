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
    componentId: string,
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

    return this.calculateFromMonitors(
      component.monitors.map((association) => ({
        status: association.monitor.status,
        weight: association.weight,
      })),
      component.aggregationMethod as AggregationMethod,
      component.failureThreshold,
    );
  }

  /** Threshold counts failing monitors, independently of consecutive-check alert thresholds. */
  calculateFromMonitors(
    monitors: Array<{ status: string; weight: number }>,
    method: AggregationMethod,
    failureThreshold: number,
  ): ComponentStatus {
    // A newly linked (pending) or paused monitor has no result yet; it must not
    // degrade a component whose other monitors have real results.
    const reporting = monitors.filter(
      (monitor) => !["pending", "paused"].includes(monitor.status),
    );
    if (reporting.length > 0) monitors = reporting;
    if (!monitors.length) return "operational";
    const failures = monitors.filter((monitor) =>
      ["down", "error", "timeout"].includes(monitor.status),
    ).length;
    if (failures > 0 && failures < failureThreshold) return "operational";
    return this.aggregateStatuses(
      monitors.map((monitor) => ({
        status: this.mapMonitorStatus(monitor.status),
        weight: monitor.weight,
      })),
      method,
    );
  }

  /**
   * Aggregate multiple monitor statuses into a single component status
   */
  private aggregateStatuses(
    statuses: MonitorStatusData[],
    method: AggregationMethod,
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
    const hierarchy: ComponentStatus[] = [
      "major_outage",
      "partial_outage",
      "degraded_performance",
      "under_maintenance",
      "operational",
    ];
    const weights = new Map<ComponentStatus, number>();
    for (const { status, weight } of statuses)
      weights.set(status, (weights.get(status) ?? 0) + Math.max(0, weight));
    let selected: ComponentStatus = "operational";
    let largest = 0;
    for (const status of hierarchy) {
      const weight = weights.get(status) ?? 0;
      if (weight > largest) {
        largest = weight;
        selected = status;
      }
    }
    return selected;
  }

  private getMajorityStatus(statuses: ComponentStatus[]): ComponentStatus {
    return this.getWeightedStatus(
      statuses.map((status) => ({ status, weight: 1 })),
    );
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
