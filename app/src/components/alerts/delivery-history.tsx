"use client";

import { AlertHistoryPanel } from "@/components/alerts/alert-history-panel";
import { ALERT_HISTORY_LIMIT, useAlertHistory } from "@/hooks/use-alerts";

/** Delivery history tab of the Notifications page: every notification sent. */
export function DeliveryHistory() {
  const { alertHistory, isLoading, error, refetch } = useAlertHistory();

  if (error && alertHistory.length === 0) {
    return (
      <p role="alert" className="py-12 text-center text-sm text-destructive">
        Failed to load delivery history.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>
          Retry
        </button>
      </p>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="pb-2 text-xs text-destructive">
          Could not refresh delivery history; showing earlier results.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Retry
          </button>
        </p>
      )}
      {alertHistory.length >= ALERT_HISTORY_LIMIT && (
        <p className="pb-2 text-xs text-muted-foreground">
          Showing the latest {ALERT_HISTORY_LIMIT} notifications.
        </p>
      )}
      <AlertHistoryPanel alertHistory={alertHistory} isLoading={isLoading} />
    </>
  );
}
