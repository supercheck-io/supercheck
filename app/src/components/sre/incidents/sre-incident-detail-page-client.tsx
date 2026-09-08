"use client";

import { SreIncidentDetailView } from "@/components/sre/incidents/sre-incident-detail-view";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSreIncidentPageData } from "@/hooks/use-sre";

export function SreIncidentDetailPageClient({
  incidentId,
  initialTab,
}: {
  incidentId: string;
  initialTab: "investigation" | "evidence" | "brief";
}) {
  const query = useSreIncidentPageData(incidentId);

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading className="h-full" message="Loading incident..." />
      );
    }

    return (
      <Unavailable
        message={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load incident"
        }
      />
    );
  }

  const { incidentResult, servicesResult } = query.data;
  if (!incidentResult.success || !incidentResult.detail) {
    return <Unavailable message={incidentResult.error} />;
  }

  return (
    <SreIncidentDetailView
      key={`${incidentId}:${initialTab}`}
      detail={incidentResult.detail}
      services={servicesResult.success ? servicesResult.services : []}
      initialTab={initialTab}
    />
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Incident unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
