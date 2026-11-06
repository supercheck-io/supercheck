"use client";

import { SreIncidentDetailView, type IncidentTabParam } from "@/components/sre/incidents/sre-incident-detail-view";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSreIncidentPageData } from "@/hooks/use-sre";

export function SreIncidentDetailPageClient({
  incidentId,
  initialTab,
}: {
  incidentId: string;
  initialTab: IncidentTabParam;
}) {
  const query = useSreIncidentPageData(incidentId);

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading className="min-h-72 flex-1" message="Loading incident..." />
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
    <div className="flex min-h-0 flex-1 flex-col">
      {!servicesResult.success && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Services unavailable</AlertTitle>
          <AlertDescription>
            Services could not be loaded, so the service cannot be changed right now. Reload to try again.
          </AlertDescription>
        </Alert>
      )}
      <SreIncidentDetailView
        // Keyed by incident only: a ?edit= or ?tab= change on the same incident keeps the open tab and drafts.
        key={incidentId}
        detail={incidentResult.detail}
        services={servicesResult.success ? servicesResult.services : []}
        initialTab={initialTab}
      />
    </div>
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
