"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setSreIncidentWatching } from "@/actions/sre-incident-lifecycle";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey } from "@/lib/sre/query-keys";

export function WatchSreIncidentButton({ incidentId, watching }: { incidentId: string; watching: boolean }) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    setPending(true);
    const result = await setSreIncidentWatching({ incidentId, watching: !watching })
      .catch(() => null)
      .finally(() => setPending(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Failed to update watch setting");
      return;
    }
    toast.success(result.message);
    await queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incidentId) });
  };

  return (
    <Button size="sm" variant="outline" onClick={toggle} disabled={pending} aria-pressed={watching}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : watching ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {watching ? "Unwatch" : "Watch"}
    </Button>
  );
}
