export type LastResult = {
  isUp: boolean;
  consecutiveFailureCount: number | null;
  consecutiveSuccessCount: number | null;
  alertsSentForFailure: number | null;
  alertsSentForRecovery: number | null;
  details?: object | null;
};

/**
 * Per-location failure/recovery sequence counters for a new result row. Mirrors
 * MonitorService.saveMonitorResultToDb so a synthetic missing-region row continues the same
 * sequence a real failed check would have.
 */
export function nextSequenceCounters(
  last: LastResult | undefined,
  isUp: boolean,
) {
  let consecutiveFailureCount = 0;
  let consecutiveSuccessCount = 0;
  let alertsSentForFailure = 0;
  let alertsSentForRecovery = 0;
  if (!isUp) {
    if (last && !last.isUp) {
      consecutiveFailureCount = (last.consecutiveFailureCount || 0) + 1;
      alertsSentForFailure = last.alertsSentForFailure || 0;
    } else {
      consecutiveFailureCount = 1;
    }
  } else if (last && last.isUp) {
    consecutiveSuccessCount = (last.consecutiveSuccessCount || 0) + 1;
    alertsSentForRecovery = last.alertsSentForRecovery || 0;
  } else {
    consecutiveSuccessCount = 1;
  }
  return {
    consecutiveFailureCount,
    consecutiveSuccessCount,
    alertsSentForFailure,
    alertsSentForRecovery,
    isStatusChange: last ? last.isUp !== isUp : true,
    recoverySequence:
      isUp &&
      (last?.isUp === false ||
        (last?.details as { recoverySequence?: boolean } | null | undefined)
          ?.recoverySequence === true),
  };
}
