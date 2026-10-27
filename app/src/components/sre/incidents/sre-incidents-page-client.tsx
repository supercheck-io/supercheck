"use client";

import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { NewIncidentAction } from "@/components/sre/incidents/new-incident-action";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SreIncidentsList } from "@/components/sre/incidents/sre-incidents-list";
import {
  IncidentAlertsTab,
  type AlertsView,
} from "@/components/alerts/incident-alerts-tab";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { useSreIncidents } from "@/hooks/use-sre";

function IncidentsTab() {
  const query = useSreIncidents();

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading
          className="min-h-72"
          message="Loading incidents..."
        />
      );
    }

    return (
      <SreIncidentsList
        incidents={[]}
        loadError={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load incidents"
        }
      />
    );
  }

  return (
    <SreIncidentsList
      incidents={query.data.incidents}
      loadError={query.data.success ? null : query.data.error}
      currentUserId={query.data.success ? query.data.currentUserId : null}
    />
  );
}

export function SreIncidentsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "alerts" ? "alerts" : "incidents";
  const view: AlertsView =
    searchParams.get("view") === "history" ? "history" : "signals";

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `/incidents?${qs}` : "/incidents", { scroll: false });
  };

  const onTabChange = (next: string) =>
    navigate((p) => {
      p.delete("view");
      if (next === "alerts") p.set("tab", "alerts");
      else p.delete("tab");
    });

  const onViewChange = (next: AlertsView) =>
    navigate((p) => {
      if (next === "history") p.set("view", "history");
      else p.delete("view");
    });

  return (
    <div className="w-full max-w-full mt-6 space-y-4 p-2">
      <PageHeader
        title="Incidents"
        description="Track, investigate, and resolve operational incidents."
        className="-mt-2"
        actions={
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="incident-header-actions"
          >
            <Button asChild type="button" variant="outline" className="h-8">
              <Link href="/incidents/analytics">
                <BarChart3 className="h-4 w-4" />
                Trends
              </Link>
            </Button>
            <NewIncidentAction />
          </div>
        }
      />
      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>
        <TabsContent value="incidents">
          <IncidentsTab />
        </TabsContent>
        <TabsContent value="alerts">
          <IncidentAlertsTab view={view} onViewChange={onViewChange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
