export type MonitorCycleSnapshot = {
  expectedLocations: string[];
  strategy: 'all' | 'any' | 'majority';
  threshold: number;
};

/** Resolve only when no remaining regional result can change the quorum, or the deadline passed. */
export function decideMonitorCycle(
  snapshot: MonitorCycleSnapshot,
  results: Record<string, boolean>,
  deadlineElapsed: boolean,
): {
  status: 'up' | 'down';
  observed: string[];
  missing: string[];
  closedBy: 'arrival' | 'deadline';
} | null {
  const expected = [...new Set(snapshot.expectedLocations)];
  const observed = expected.filter(
    (location) => typeof results[location] === 'boolean',
  );
  const missing = expected.filter((location) => !observed.includes(location));
  const up = observed.filter((location) => results[location]).length;
  const required =
    snapshot.strategy === 'all'
      ? expected.length
      : snapshot.strategy === 'any'
        ? 1
        : Math.ceil((expected.length * snapshot.threshold) / 100);
  const success = observed.length > 0 && up >= required;
  const failure = up + missing.length < required;
  if (!deadlineElapsed && !success && !failure && missing.length > 0)
    return null;
  return {
    status: success ? 'up' : 'down',
    observed,
    missing,
    closedBy: deadlineElapsed ? 'deadline' : 'arrival',
  };
}
