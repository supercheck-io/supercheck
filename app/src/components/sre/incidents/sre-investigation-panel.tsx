"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, SearchCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  createSreInvestigationReportSnapshot,
} from "@/actions/sre-investigation-reports";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

type SreInvestigationPanelProps = {
  incidentId: string;
  hasPrimaryService: boolean;
  serviceMappingHref: string;
  evidenceReferences?: Array<{
    id: string;
    title: string;
    evidenceType: string;
  }>;
  toolMetrics?: {
    total: number;
    errors: number;
    averageDurationMs: number;
  };
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
  /** Opens the evidence brief in place; the ?tab link does nothing while the sheet is open. */
  onCollectEvidence?: () => void;
};

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  serviceMappingHref,
  evidenceReferences = [],
  toolMetrics = { total: 0, errors: 0, averageDurationMs: 0 },
  latestInvestigation = null,
  canInvestigate = false,
  canMapService = false,
  canUseLiveConnectors = false,
  investigationEnabled = true,
  onCollectEvidence,
}: SreInvestigationPanelProps) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const liveConnectorsEnabled = useLiveConnectors && hasPrimaryService && canUseLiveConnectors;
  const [isInvestigating, startInvestigationTransition] = useTransition();
  const investigationRunning =
    isInvestigating || latestInvestigation?.status === "running";
  const [investigationError, setInvestigationError] = useState<string | null>(
    null,
  );
  const [guidance, setGuidance] = useState("");
  const runInvestigation = (note?: string) => {
    if (!canInvestigate || !investigationEnabled || investigationRunning)
      return;
    setInvestigationError(null);
    startInvestigationTransition(async () => {
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
        await Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
          }),
          queryClient.invalidateQueries({
            queryKey: getSreIncidentsQueryKey(projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: getSreEvidenceGraphQueryKey(projectId),
          }),
        ]);
      }
    });
  };

  if (!canInvestigate) return null;

  return (
    <div className="space-y-4" data-testid="investigation-controls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          AI reads your evidence and connected sources. It never changes your systems.
        </p>
        <Button
          size="sm"
          onClick={() => runInvestigation()}
          disabled={investigationRunning || !investigationEnabled}
        >
          {investigationRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <SearchCheck className="mr-2 h-4 w-4" />
          )}
          {investigationRunning ? "Investigating..." : latestInvestigation ? "Run again" : "Run investigation"}
        </Button>
      </div>
        {investigationError && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
          >
            {investigationError}
          </p>
        )}
        {investigationRunning && (
          <p role="status" className="text-sm text-muted-foreground">
            Investigation in progress. Results will appear when the run
            finishes.
          </p>
        )}
        {!investigationEnabled && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">
                Investigation is unavailable
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                An administrator must enable the investigation service before a
                new run can start. Existing results and evidence remain
                available.
              </p>
            </div>
          </div>
        )}
        {canInvestigate && canUseLiveConnectors && (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-4">
            <Switch
              id="live-connectors"
              checked={liveConnectorsEnabled}
              disabled={
                !hasPrimaryService ||
                investigationRunning ||
                !investigationEnabled
              }
              onCheckedChange={setUseLiveConnectors}
            />
            <div className="space-y-1">
              <Label htmlFor="live-connectors">Include live sources</Label>
              <p className="text-sm text-muted-foreground">
                Query connected tools for this service. Off by default;
                read-only and bounded.
              </p>
              {!hasPrimaryService && (
                <p className="text-sm text-muted-foreground">
                  Link a service to use live sources.
                  {canMapService && (
                    <Link
                      href={serviceMappingHref}
                      className="ml-1 underline underline-offset-4"
                    >
                      Link service
                    </Link>
                  )}
                </p>
              )}
            </div>
          </div>
        )}
        {canInvestigate && !canUseLiveConnectors && (
          <p className="text-sm text-muted-foreground">
            Uses saved evidence. Your role does not permit live connector
            queries.
          </p>
        )}

        {canInvestigate && investigationEnabled && latestInvestigation && latestInvestigation.status !== "running" && (
          <form
            className="space-y-2 rounded-lg border bg-muted/10 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (guidance.trim()) runInvestigation(guidance.trim());
            }}
          >
            <Label htmlFor="rerun-guidance">Re-run with my note</Label>
            <p className="text-sm text-muted-foreground">
              Tell the investigation what to look at or what it got wrong. The
              note is treated as a hint, not as evidence.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="rerun-guidance"
                value={guidance}
                maxLength={500}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder="For example: check the CDN and DNS changes"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={investigationRunning || !guidance.trim()}
              >
                Re-run with my note
              </Button>
            </div>
          </form>
        )}

        {!latestInvestigation && (
          <div className="rounded-lg border border-dashed p-6">
            <p className="font-medium">Start with the evidence</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {evidenceReferences.length > 0
                ? `${evidenceReferences.length} saved evidence ${evidenceReferences.length === 1 ? "item is" : "items are"} available. Run an investigation to review likely causes and next checks.`
                : "No evidence is saved yet. Generate an evidence brief to collect available Supercheck context before investigating."}
            </p>
            {evidenceReferences.length === 0 && canInvestigate && (
              onCollectEvidence ? (
                <Button type="button" variant="link" className="mt-2 h-auto p-0" onClick={onCollectEvidence}>
                  Collect evidence
                </Button>
              ) : (
                <Button asChild variant="link" className="mt-2 h-auto p-0">
                  <Link href={`/incidents/${incidentId}?tab=brief`}>
                    Collect evidence
                  </Link>
                </Button>
              )
            )}
          </div>
        )}

        {toolMetrics.total > 0 && (
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Investigation diagnostics
            </summary>
            <div className="mt-3">
              <div className="grid overflow-hidden rounded-lg border sm:grid-cols-3">
                <div className="border-b px-4 py-3 sm:border-b-0 sm:border-r">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Tool calls
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {toolMetrics.total}
                  </p>
                </div>
                <div className="border-b px-4 py-3 sm:border-b-0 sm:border-r">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Failures
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {toolMetrics.errors}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Avg latency
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {toolMetrics.total > 0
                      ? `${toolMetrics.averageDurationMs} ms`
                      : "-"}
                  </p>
                </div>
              </div>
            </div>
          </details>
        )}
    </div>
  );
}

/** Saves a point-in-time copy of the latest completed report. Feedback lives on the AI summary card. */
export function SreReportSnapshotControl({
  incidentId,
  latestInvestigation,
  latestReportSnapshot = null,
  canInvestigate = false,
}: {
  incidentId: string;
  latestInvestigation: { id: string; status: string } | null;
  latestReportSnapshot?: { id: string; title: string | null; createdAt: Date | string } | null;
  canInvestigate?: boolean;
}) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [isSaving, startTransition] = useTransition();
  const [snapshotId, setSnapshotId] = useState(latestReportSnapshot?.id ?? null);

  if (latestInvestigation?.status !== "completed") {
    return <p className="text-sm text-muted-foreground">A snapshot is available after an investigation completes.</p>;
  }

  const save = () =>
    startTransition(async () => {
      try {
        const result = await createSreInvestigationReportSnapshot({
          investigationRunId: latestInvestigation.id,
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setSnapshotId(result.snapshotId);
        toast.success(result.reused ? "Already saved for this report content" : "Snapshot saved");
        await queryClient.invalidateQueries({
          queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
        });
      } catch {
        toast.error("Could not confirm the saved snapshot. Refresh the incident and try again.");
      }
    });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {snapshotId
          ? `Snapshot saved${latestReportSnapshot?.title ? `: ${latestReportSnapshot.title}` : ""}.`
          : "Save the sanitized report to lock it for audit and review."}
      </p>
      {canInvestigate && (
        <Button type="button" variant="outline" size="sm" onClick={save} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save report snapshot
        </Button>
      )}
    </div>
  );
}
