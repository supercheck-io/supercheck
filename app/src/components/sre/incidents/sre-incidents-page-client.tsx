"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { NewIncidentAction } from "@/components/sre/incidents/new-incident-action";
import { SreIncidentsList } from "@/components/sre/incidents/sre-incidents-list";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { useSreIncidents } from "@/hooks/use-sre";

function IncidentsTab() {
  const [scope, setScope] = useState<"active" | "all">("active");
  const query = useSreIncidents(scope);

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
      truncated={query.data.success && query.data.truncated}
      hasIncidents={query.data.success ? query.data.hasIncidents : false}
      onScopeChange={setScope}
    />
  );
}

export function SreIncidentsPageClient() {
  return (
    <div className="mt-6 w-full max-w-full space-y-4 p-2">
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
      <IncidentsTab />
    </div>
  );
}
