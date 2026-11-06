"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, SearchCheck, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toneButton } from "@/components/sre/incidents/incident-ui";
import {
  createSreInvestigationReportSnapshot,
} from "@/actions/sre-investigation-reports";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

type SreInvestigationPanelProps = {
  incidentId: string;
  hasPrimaryService: boolean;
  serviceMappingHref: string;
  latestInvestigation?: {
    id: string;
    status: "running" | "completed" | "failed" | "aborted" | "timed_out";
    summary: string | null;
    completedAt: Date | string | null;
  } | null;
  canInvestigate?: boolean;
  canMapService?: boolean;
  canUseLiveConnectors?: boolean;
  investigationEnabled?: boolean;
  /** Extra toolbar controls after the run options, such as the sheet's overflow menu. */
  children?: React.ReactNode;
};

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  serviceMappingHref,
  latestInvestigation = null,
  canInvestigate = false,
  canMapService = false,
  canUseLiveConnectors = false,
  investigationEnabled = true,
  children,
}: SreInvestigationPanelProps) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const liveConnectorsEnabled = useLiveConnectors && hasPrimaryService && canUseLiveConnectors;
  // In the query client, not component state: a tab switch remounts this panel while the run is still going.
  const investigationMutationKey = ["sre-investigate", projectId, incidentId] as const;
  const isInvestigating = useIsMutating({ mutationKey: investigationMutationKey }) > 0;
  const { mutate: startInvestigation } = useMutation({
    mutationKey: investigationMutationKey,
    mutationFn: async (job: () => Promise<void>) => job(),
  });
  const startedRef = useRef(false);
  const investigationRunning =
    isInvestigating || latestInvestigation?.status === "running";
  const [investigationError, setInvestigationError] = useState<string | null>(
    null,
  );
  const [guidance, setGuidance] = useState("");
  const runInvestigation = (note?: string) => {
    // The ref closes the gap before the mutation state renders, so a quick second click cannot send a second POST.
    if (!canInvestigate || !investigationEnabled || investigationRunning || startedRef.current)
      return;
    startedRef.current = true;
    setInvestigationError(null);
    startInvestigation(async () => {
      try {
        const response = await fetch("/api/sre/investigate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(projectId ? { "x-project-id": projectId } : {}),
          },
          body: JSON.stringify({
            incidentId,
            useLiveConnectors: liveConnectorsEnabled,
            ...(note ? { guidance: note } : {}),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          summary?: string;
        } | null;

        if (!response.ok) {
          const message =
            body?.error ??
            "Could not confirm the investigation result. Refresh the incident before starting another run.";
          setInvestigationError(message);
          toast.error(message);
          return;
        }

        if (response.status === 202) {
          if (note) setGuidance("");
          toast.success("Investigation started", {
            description:
              "Results will appear when the run completes. Keep this incident open or refresh it.",
          });
          return;
        }

        if (note) setGuidance("");
        toast.success("Investigation completed", {
          description: body?.summary
            ? body.summary.slice(0, 120)
            : "Incident summary updated",
        });
      } catch {
        const message =
          "Connection interrupted. The investigation may still be running. Refresh the incident before starting another run.";
        setInvestigationError(message);
        toast.error(message);
      } finally {
        startedRef.current = false;
        await Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
          }),
          queryClient.invalidateQueries({
            queryKey: getSreIncidentsQueryKey(projectId),
          }),
        ]);
      }
    });
  };

  if (!canInvestigate) return null;

  return (
    <div className="space-y-3" data-testid="investigation-controls" aria-busy={investigationRunning}>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          // A repeat run is a secondary AI action; the first run stays the primary button.
          variant={latestInvestigation ? "outline" : "default"}
          className={latestInvestigation ? toneButton("violet") : undefined}
          onClick={() => runInvestigation()}
          disabled={investigationRunning || !investigationEnabled}
        >
          {investigationRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SearchCheck className="h-4 w-4" />
          )}
          {investigationRunning ? "Investigating..." : latestInvestigation ? "Run again" : "Run investigation"}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Run options">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-4">
            <p className="text-sm text-muted-foreground">
              AI reads your evidence and connected sources. It never changes your systems.
            </p>
            {canUseLiveConnectors ? (
              <div className="flex items-start gap-3">
                <Switch
                  id="live-connectors"
                  checked={liveConnectorsEnabled}
                  disabled={!hasPrimaryService || investigationRunning || !investigationEnabled}
                  onCheckedChange={setUseLiveConnectors}
                />
                <div className="space-y-1">
                  <Label htmlFor="live-connectors">Include live sources</Label>
                  <p className="text-xs text-muted-foreground">
                    Query connected tools for this service. Off by default; read-only and bounded.
                  </p>
                  {!hasPrimaryService && (
                    <p className="text-xs text-muted-foreground">
                      Link a service to use live sources.
                      {canMapService && (
                        <Link href={serviceMappingHref} className="ml-1 underline underline-offset-4">
                          Link service
                        </Link>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Uses saved evidence. Your role does not permit live connector queries.
              </p>
            )}
            {investigationEnabled && latestInvestigation && latestInvestigation.status !== "running" && (
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (guidance.trim()) runInvestigation(guidance.trim());
                }}
              >
                <Label htmlFor="rerun-guidance">Re-run with my note</Label>
                <p className="text-xs text-muted-foreground">
                  Say what to look at or what it got wrong. The note is a hint, not evidence.
                </p>
                <Input
                  id="rerun-guidance"
                  value={guidance}
                  maxLength={500}
                  onChange={(event) => setGuidance(event.target.value)}
                  placeholder="For example: check the CDN and DNS changes"
                />
                <Button type="submit" variant="outline" size="sm" disabled={investigationRunning || !guidance.trim()}>
                  Re-run with my note
                </Button>
              </form>
            )}
          </PopoverContent>
        </Popover>
        {children}
      </div>
      {investigationError && (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {investigationError}
        </p>
      )}
      {!investigationEnabled && (
        <div role="status" className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium">Investigation is unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">
              An administrator must enable the investigation service before a new run can start. Existing results and
              evidence remain available.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Overflow action: saves a point-in-time copy of the latest completed report. The saved state shows in the sheet's status line. */
export function SreReportSnapshotMenuItem({
  incidentId,
  latestInvestigation,
}: {
  incidentId: string;
  latestInvestigation: { id: string; status: string } | null;
}) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();

  if (latestInvestigation?.status !== "completed") return null;

  const save = async () => {
    try {
      const result = await createSreInvestigationReportSnapshot({
        investigationRunId: latestInvestigation.id,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.reused ? "Already saved for this report content" : "Snapshot saved");
      await queryClient.invalidateQueries({
        queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
      });
    } catch {
      toast.error("Could not confirm the saved snapshot. Refresh the incident and try again.");
    }
  };

  return <DropdownMenuItem onSelect={() => void save()}>Save report snapshot</DropdownMenuItem>;
}
