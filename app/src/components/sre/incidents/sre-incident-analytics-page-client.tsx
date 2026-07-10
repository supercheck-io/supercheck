"use client";

import { SreIncidentAnalytics } from "@/components/sre/incidents/sre-incident-analytics";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useSreIncidentAnalytics } from "@/hooks/use-sre";

export function SreIncidentAnalyticsPageClient() {
  const query = useSreIncidentAnalytics();

  if (!query.data) {
    if (query.isPending) {
      return (
        <SuperCheckLoading
          className="min-h-72"
          message="Loading incident trends..."
        />
      );
    }

    return (
      <Unavailable
        message={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load incident trends"
        }
      />
    );
  }

  return query.data.success ? (
    <SreIncidentAnalytics analytics={query.data.analytics} />
  ) : (
    <Unavailable message={query.data.error} />
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="py-12 text-center">
      <h1 className="text-lg font-semibold">Incident trends unavailable</h1>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
