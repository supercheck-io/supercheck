import { randomUUID } from 'node:crypto';

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

/**
 * Id of the outage a result row belongs to, kept in its details like the counters: a failing row starts one
 * (or continues the previous failing row's) and an up row keeps the key of the outage it recovers from, so a
 * recovery alert is claimed under the same key as the failure alerts. A legacy failing row without a key gets
 * one here, mid-outage. Used by single-location evaluation; multi-location keeps it in aggregatedAlertState.
 */
export function nextOutageKey(
  last: LastResult | undefined,
  isUp: boolean,
): string | undefined {
  const stored = (last?.details as { outageKey?: unknown } | null | undefined)
    ?.outageKey;
  const carried = typeof stored === 'string' ? stored : undefined;
  if (!isUp)
    return last && !last.isUp ? (carried ?? randomUUID()) : randomUUID();
  const recovering =
    last &&
    (!last.isUp ||
      (last.details as { recoverySequence?: boolean } | null | undefined)
        ?.recoverySequence === true);
  return recovering ? carried : undefined;
}
