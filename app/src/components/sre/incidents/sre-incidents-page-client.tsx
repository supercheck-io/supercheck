"use client";

import { SreIncidentsList } from "@/components/sre/incidents/sre-incidents-list";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useSreIncidents } from "@/hooks/use-sre";

export function SreIncidentsPageClient() {
  const query = useSreIncidents();

  if (!query.data) {
    if (query.isPending) {
      return (
        <SuperCheckLoading
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
    />
  );
}
