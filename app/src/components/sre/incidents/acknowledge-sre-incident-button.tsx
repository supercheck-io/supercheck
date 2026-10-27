"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { acknowledgeSreIncident } from "@/actions/sre-incident-lifecycle";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreIncidentDetailQueryKey,
  getSreIncidentTimelineQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

export function AcknowledgeSreIncidentButton({ incidentId }: { incidentId: string }) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const acknowledge = async () => {
    setPending(true);
    const result = await acknowledgeSreIncident({ incidentId }).catch(() => null).finally(() => setPending(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Failed to acknowledge incident");
      return;
    }
    toast.success(result.message);
    await Promise.allSettled(
      [
        getSreIncidentDetailQueryKey(projectId, incidentId),
        getSreIncidentTimelineQueryKey(projectId, incidentId),
        getSreIncidentsQueryKey(projectId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  return (
    <Button size="sm" onClick={acknowledge} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
      Acknowledge
    </Button>
  );
}
