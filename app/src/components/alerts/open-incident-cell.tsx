"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSreIncidentFromAlert } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/hooks/use-project-context";
import { isActionableAlertForIncident } from "@/lib/alert-escalation";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { getSreIncidentAnalyticsQueryKey, getSreIncidentsQueryKey } from "@/lib/sre/query-keys";
import type { AlertHistory } from "./schema";

/** A delivered failure alert that can still open an incident, e.g. when the check has automatic incidents turned off. */
export function isEscalatableAlert(alert: AlertHistory) {
  return isActionableAlertForIncident(alert.status, alert.type, alert.message);
}

export function OpenIncidentCell({ alertHistoryId, targetName }: { alertHistoryId: string; targetName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const { currentProject, projectId, loading, error } = useProjectContext();
  const canCreate = Boolean(
    !loading &&
      !error &&
      currentProject?.userRole &&
      checkRolePermissionsClient(currentProject.userRole, { sre_incident: ["create"] }),
  );

  if (!canCreate) return <span className="text-sm text-muted-foreground">-</span>;

  const open = () =>
    startTransition(async () => {
      try {
        const result = await createSreIncidentFromAlert({ alertHistoryId });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getSreIncidentsQueryKey(projectId) }),
          queryClient.invalidateQueries({ queryKey: getSreIncidentAnalyticsQueryKey(projectId) }),
        ]);
        router.push(`/incidents/${result.incident.id}`);
      } catch {
        toast.error("Could not open the incident. Please try again.");
      }
    });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isPending}
      aria-label={`Open incident for ${targetName}`}
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
    >
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      Open incident
    </Button>
  );
}
