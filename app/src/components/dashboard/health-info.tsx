"use client";

import { MetricInfoButton } from "./metric-card";

/** Explains exactly how the Operational / Issues Detected status is derived (see lib/dashboard/system-health.ts). */
export const HEALTH_INFO = {
  title: "How project status is calculated",
  description:
    "The status is Operational when none of the checks below find a problem. Otherwise it shows Issues Detected and lists each one.",
  bullets: [
    "Monitors: any monitor whose current status is down (3 or more is critical, 2 high)",
    "Job runs: failed or errored job runs in the last 24 hours (more than 5 is high severity)",
    "Execution queue at capacity: running executions have reached the running capacity",
    "Execution queue nearing capacity: running executions are at 80% or more of capacity",
    "Backlog: more than 10 executions are queued and waiting (more than 20 is high severity)",
    "Paused, pending and maintenance monitors do not count as issues",
  ],
  ariaLabel: "Learn how project status is calculated",
};

export function HealthInfo() {
  return <MetricInfoButton {...HEALTH_INFO} align="end" />;
}
