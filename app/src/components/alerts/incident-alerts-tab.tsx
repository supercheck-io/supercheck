"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SreAlertsView } from "@/components/alerts/sre-alerts-view";
import { AlertHistoryPanel } from "@/components/alerts/alert-history-panel";
import { useAlertHistory } from "@/hooks/use-alerts";

export type AlertsView = "signals" | "history";

/** Alerts tab of the Incidents page: signals, with a toggle to delivery history. */
export function IncidentAlertsTab({
  view,
  onViewChange,
}: {
  view: AlertsView;
  onViewChange: (view: AlertsView) => void;
}) {
  const { alertHistory, isLoading } = useAlertHistory();

  // Lives in the toolbar row; the tooltip replaces the old (i) icon.
  const viewSwitch = (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as AlertsView)}>
      <TabsList
        className="ml-auto h-8"
        title="Signals group repeated failures; History lists every notification sent."
      >
        <TabsTrigger value="signals">Signals</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return view === "history" ? (
    <AlertHistoryPanel alertHistory={alertHistory} isLoading={isLoading} toolbarEnd={viewSwitch} />
  ) : (
    <SreAlertsView alerts={alertHistory} isLoading={isLoading} toolbarEnd={viewSwitch} />
  );
}
