"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoTip } from "@/components/ui/info-tip";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => onViewChange(v as AlertsView)}>
          <TabsList>
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>
        <InfoTip label="About alerts">
          Alerts are automatic: a check failed or recovered. Alerts that need a
          person open an incident.
        </InfoTip>
      </div>
      {view === "history" ? (
        <AlertHistoryPanel alertHistory={alertHistory} isLoading={isLoading} />
      ) : (
        <SreAlertsView alerts={alertHistory} isLoading={isLoading} />
      )}
    </div>
  );
}
