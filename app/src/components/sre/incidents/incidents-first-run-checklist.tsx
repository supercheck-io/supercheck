import Link from "next/link";
import { Siren } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Button } from "@/components/ui/button";

export function IncidentsFirstRunChecklist() {
  return (
    <DashboardEmptyState
      className="min-h-[420px]"
      title="No incidents"
      description="Incidents open automatically when a monitor alert fires. You can also declare one manually with New incident."
      icon={<Siren className="h-10 w-10" aria-hidden="true" />}
      action={
        <Button asChild variant="outline" data-testid="incidents-first-run">
          <Link href="/notifications">Set up alerts</Link>
        </Button>
      }
    />
  );
}
