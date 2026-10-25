"use client";

import { HEALTH_THRESHOLDS as T } from "@/lib/dashboard/system-health";
import { MetricInfoButton } from "./metric-card";

/** Explains exactly how the Operational / Issues Detected status is derived (see lib/dashboard/system-health.ts). */
export const HEALTH_INFO = {
  title: "How project status is calculated",
  description:
    "The status is Operational when none of the checks below find a problem. Otherwise it shows Issues Detected and lists each one.",
  bullets: [
    `Monitors: any monitor whose current status is down (${T.monitorsDownCritical} or more is critical, ${T.monitorsDownHigh} high)`,
    `Job runs: failed or errored job runs in the last ${T.failedRunsWindowHours} hours (more than ${T.failedRunsHigh} is high severity)`,
    "Execution queue at capacity: running executions have reached the running capacity",
    `Execution queue nearing capacity: running executions are at ${Math.round(T.queueNearCapacityRatio * 100)}% or more of capacity`,
    `Backlog: more than ${T.queuedBacklog} queued runs waiting (more than ${T.queuedBacklogHigh} is high severity)`,
    "Only monitors currently down count; paused, pending, maintenance and error monitors do not",
  ],
  ariaLabel: "Learn how project status is calculated",
};

export function HealthInfo() {
  return <MetricInfoButton {...HEALTH_INFO} align="end" />;
}
