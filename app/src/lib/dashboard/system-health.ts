export type SystemIssue = {
  type: "monitor" | "job" | "queue";
  message: string;
  severity: "low" | "medium" | "high" | "critical";
};

export type SystemHealthInput = {
  monitorsDown: number;
  downMonitors: Array<{ name: string; type: string }>;
  /** failed + error runs in the last 24 hours */
  failedRuns24h: number;
  queue: {
    running: number;
    runningCapacity: number;
    queued: number;
  };
};

export const HEALTH_THRESHOLDS = {
  failedRunsWindowHours: 24,
  failedRunsHigh: 5,
  monitorsDownCritical: 3,
  monitorsDownHigh: 2,
  queueNearCapacityRatio: 0.8,
  queuedBacklog: 10,
  queuedBacklogHigh: 20,
} as const;

/**
 * Single source of truth for the dashboard's system health issue list. Built
 * on the server so every issue (monitors, failed jobs, queue capacity) reaches
 * the "Operational / Issues detected" pill.
 */
export function buildSystemIssues(input: SystemHealthInput): SystemIssue[] {
  const issues: SystemIssue[] = [];
  const t = HEALTH_THRESHOLDS;
  const { monitorsDown, downMonitors, failedRuns24h, queue } = input;

  if (monitorsDown > 0) {
    issues.push({
      type: "monitor",
      message: `${monitorsDown} monitor${monitorsDown > 1 ? "s" : ""} currently down`,
      severity:
        monitorsDown >= t.monitorsDownCritical ? "critical" : monitorsDown >= t.monitorsDownHigh ? "high" : "medium",
    });
    downMonitors.slice(0, 3).forEach((m) => {
      issues.push({
        type: "monitor",
        message: `${m.name} (${m.type}) is down`,
        severity: "high",
      });
    });
  }

  if (failedRuns24h > 0) {
    issues.push({
      type: "job",
      message: `${failedRuns24h} job run${failedRuns24h === 1 ? "" : "s"} failed in the last ${t.failedRunsWindowHours} hours`,
      severity: failedRuns24h > t.failedRunsHigh ? "high" : "medium",
    });
  }

  if (queue.runningCapacity > 0 && queue.running >= queue.runningCapacity) {
    issues.push({
      type: "queue",
      message: `Execution queue at capacity (${queue.running}/${queue.runningCapacity} running)`,
      severity: "high",
    });
  } else if (
    queue.runningCapacity > 0 &&
    queue.running >= queue.runningCapacity * t.queueNearCapacityRatio
  ) {
    issues.push({
      type: "queue",
      message: `Execution queue nearing capacity (${queue.running}/${queue.runningCapacity} running)`,
      severity: "medium",
    });
  }

  if (queue.queued > t.queuedBacklog) {
    issues.push({
      type: "queue",
      message: `${queue.queued} jobs queued waiting for execution`,
      severity: queue.queued > t.queuedBacklogHigh ? "high" : "medium",
    });
  }

  return issues;
}
