"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SreAlertsView } from "@/components/alerts/sre-alerts-view";
import { AlertHistoryPanel } from "@/components/alerts/alert-history-panel";
import { ALERT_HISTORY_LIMIT, useAlertHistory } from "@/hooks/use-alerts";

export type AlertsView = "signals" | "history";

/** Alerts tab of the Incidents page: signals, with a toggle to delivery history. */
export function IncidentAlertsTab({
  view,
  onViewChange,
}: {
  view: AlertsView;
  onViewChange: (view: AlertsView) => void;
}) {
  const { alertHistory, isLoading, error } = useAlertHistory();

  // Lives in the toolbar row; the tooltip replaces the old (i) icon.
  const viewSwitch = (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as AlertsView)}>
      <TabsList
        className="ml-auto h-8"
        aria-describedby="alerts-view-help"
        title="Signals group repeated failures; History lists every notification sent."
      >
        <TabsTrigger value="signals">Signals</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <span id="alerts-view-help" className="sr-only">
        Signals group repeated failures; History lists every notification sent.
      </span>
    </Tabs>
  );

  if (error) {
    return (
      <p role="alert" className="py-12 text-center text-sm text-destructive">
        Failed to load alerts. Please try again.
      </p>
    );
  }

  return (
    <>
      {alertHistory.length >= ALERT_HISTORY_LIMIT && (
        <p className="pb-2 text-xs text-muted-foreground">
          Showing the latest {ALERT_HISTORY_LIMIT} notifications.
        </p>
      )}
      {view === "history" ? (
        <AlertHistoryPanel alertHistory={alertHistory} isLoading={isLoading} toolbarEnd={viewSwitch} />
      ) : (
        <SreAlertsView alerts={alertHistory} isLoading={isLoading} toolbarEnd={viewSwitch} />
      )}
    </>
  );
}
