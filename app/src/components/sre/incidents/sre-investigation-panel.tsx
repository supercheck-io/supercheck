"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  SearchCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSreInvestigationReportSnapshot,
  saveSreInvestigationReportFeedback,
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
  latestReportSnapshot?: {
    id: string;
    title: string | null;
    createdAt: Date | string;
  } | null;
  myReportFeedback?: {
    accuracy:
      | "accurate"
      | "partially_accurate"
      | "incorrect"
      | "needs_more_evidence";
    notes: string | null;
    rejectedHypotheses: string[];
  } | null;
  canInvestigate?: boolean;
  canUseLiveConnectors?: boolean;
  investigationEnabled?: boolean;
};

type ReadinessItem = {
  label: string;
  description: string;
  ready: boolean;
  optional?: boolean;
  action?: {
    label: string;
    href: string;
  };
};

function ReadinessRow({ item }: { item: ReadinessItem }) {
  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      {item.ready || item.optional ? (
        <CheckCircle2
          className={
            item.optional
              ? "mt-0.5 h-4 w-4 text-muted-foreground"
              : "mt-0.5 h-4 w-4 text-emerald-500"
          }
        />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{item.label}</p>
          <Badge variant="outline" className="capitalize">
            {item.optional
              ? "Optional"
              : item.ready
                ? "Ready"
                : "Needs attention"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        {!item.ready && item.action && (
          <Button asChild variant="link" className="mt-1 h-auto p-0 text-sm">
            <Link href={item.action.href}>{item.action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  serviceMappingHref,
  evidenceReferences = [],
  toolMetrics = { total: 0, errors: 0, averageDurationMs: 0 },
  latestInvestigation = null,
  latestReportSnapshot = null,
  myReportFeedback = null,
  canInvestigate = false,
  canUseLiveConnectors = false,
  investigationEnabled = true,
}: SreInvestigationPanelProps) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const [isInvestigating, startInvestigationTransition] = useTransition();
  const investigationRunning =
    isInvestigating || latestInvestigation?.status === "running";
  const [investigationError, setInvestigationError] = useState<string | null>(
    null,
  );
  const [isSavingReport, startReportTransition] = useTransition();
  const [reportSnapshotId, setReportSnapshotId] = useState(
    latestReportSnapshot?.id ?? null,
  );
  const [accuracy, setAccuracy] = useState<
    "accurate" | "partially_accurate" | "incorrect" | "needs_more_evidence"
  >(myReportFeedback?.accuracy ?? "accurate");
  const [feedbackNotes, setFeedbackNotes] = useState(
    myReportFeedback?.notes ?? "",
  );
  const [rejectedHypotheses, setRejectedHypotheses] = useState(
    myReportFeedback?.rejectedHypotheses.join("\n") ?? "",
  );
  const rejectedHypothesisValues = rejectedHypotheses
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const rejectedHypothesesInvalid =
    rejectedHypothesisValues.length > 10 ||
    rejectedHypothesisValues.some((value) => value.length > 300);

  const readinessItems: ReadinessItem[] = [
    {
      label: "Stored evidence",
      ready: evidenceReferences.length > 0,
      description:
        evidenceReferences.length > 0
          ? `${evidenceReferences.length} evidence item${evidenceReferences.length === 1 ? "" : "s"} available for citations.`
          : "Generate a brief or collect evidence before relying on an investigation summary.",
      action:
        evidenceReferences.length > 0
          ? undefined
          : {
              label: "Generate brief",
              href: `/incidents/${incidentId}?tab=brief`,
            },
    },
    {
      label: "Service mapping",
      ready: hasPrimaryService,
      optional: !useLiveConnectors && !hasPrimaryService,
      description: !useLiveConnectors
        ? "Only required when live connector tools are enabled."
        : hasPrimaryService
          ? "Live connector tools will be scoped to the incident service."
          : "Map a primary service before using live connector tools.",
      action: hasPrimaryService || !canInvestigate
        ? undefined
        : { label: "Map service", href: serviceMappingHref },
    },
    {
      label: "Connector tools",
      optional: !useLiveConnectors,
      ready: !useLiveConnectors || (hasPrimaryService && canUseLiveConnectors),
      description: !canUseLiveConnectors
        ? "Your role does not permit live connector queries; stored evidence remains available."
        : useLiveConnectors
          ? "Connectors will run read-only with service scope and output limits."
          : "Live sources are off. This investigation will use stored evidence only.",
    },
  ];

  const runInvestigation = () => {
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
          body: JSON.stringify({ incidentId, useLiveConnectors }),
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
          toast.success("Investigation started", {
            description:
              "Results will appear when the run completes. Keep this incident open or refresh it.",
          });
          return;
        }

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

  const refreshIncidentDetail = () =>
    queryClient.invalidateQueries({
      queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
    });

  const saveSnapshot = () => {
    if (!latestInvestigation) return;
    startReportTransition(async () => {
      try {
        const result = await createSreInvestigationReportSnapshot({
          investigationRunId: latestInvestigation.id,
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        setReportSnapshotId(result.snapshotId);
        toast.success(
          result.reused
            ? "Already saved for this report content"
            : "Snapshot saved",
        );
        await refreshIncidentDetail();
      } catch {
        toast.error(
          "Could not confirm the saved snapshot. Refresh the incident and try again.",
        );
      }
    });
  };

  const saveFeedback = () => {
    if (!reportSnapshotId || rejectedHypothesesInvalid) return;
    startReportTransition(async () => {
      try {
        const result = await saveSreInvestigationReportFeedback({
          reportSnapshotId,
          accuracy,
          notes: feedbackNotes,
          rejectedHypotheses: rejectedHypothesisValues,
        });
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Feedback saved");
        await refreshIncidentDetail();
      } catch {
        toast.error("Could not confirm the saved feedback. Please try again.");
      }
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg">Investigation</CardTitle>
            <CardDescription>
              Run a read-only check from stored evidence and optional live
              connector data.
            </CardDescription>
          </div>
          {canInvestigate ? (
            <Button
              className="w-full sm:w-auto"
              onClick={runInvestigation}
              disabled={investigationRunning || !investigationEnabled}
            >
              {investigationRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <SearchCheck className="mr-2 h-4 w-4" />
              )}
              Run investigation
            </Button>
          ) : (
            <Badge variant="outline">Read-only access</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
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

        {canInvestigate && canUseLiveConnectors && (
          <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-4">
            <Switch
              id="live-connectors"
              checked={useLiveConnectors}
              disabled={
                !hasPrimaryService ||
                investigationRunning ||
                !investigationEnabled
              }
              onCheckedChange={setUseLiveConnectors}
            />
            <div className="space-y-1">
              <Label htmlFor="live-connectors">Use live connector tools</Label>
              <p className="text-sm text-muted-foreground">
                Optional read-only connector execution. Requires a mapped
                primary service.
              </p>
              {!hasPrimaryService && (
                <Badge variant="outline">Primary service required</Badge>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg border px-4">
          {readinessItems.map((item) => (
            <ReadinessRow key={item.label} item={item} />
          ))}
        </div>

        {latestInvestigation && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Latest result</p>
                <p className="text-xs text-muted-foreground">
                  {latestInvestigation.completedAt
                    ? `Completed ${new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(latestInvestigation.completedAt))}`
                    : "Result is not complete"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Live agent summary; save a report snapshot below to lock a
                  sanitized review copy.
                </p>
              </div>
              <Badge variant="outline" className="capitalize">
                {latestInvestigation.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="max-h-96 overflow-y-auto break-words px-4 py-4 text-sm leading-6">
              <SreMessageContent
                content={
                  latestInvestigation.summary ??
                  "No investigation summary was returned."
                }
              />
            </div>
          </div>
        )}

        {latestInvestigation?.status === "completed" && (
          <div className="space-y-3 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">
                Report snapshot &amp; feedback
              </p>
              <p className="text-sm text-muted-foreground">
                Save the current sanitized investigation report for audit and
                review.
              </p>
            </div>
            {!reportSnapshotId ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Save a snapshot to lock this investigation report for review.
                </p>
                {canInvestigate && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveSnapshot}
                    disabled={isSavingReport}
                  >
                    {isSavingReport && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save report snapshot
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Snapshot saved
                  {latestReportSnapshot?.title
                    ? `: ${latestReportSnapshot.title}`
                    : ""}
                  .
                </p>
                {canInvestigate ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="report-accuracy">Accuracy</Label>
                      <Select
                        value={accuracy}
                        onValueChange={(value) =>
                          setAccuracy(value as typeof accuracy)
                        }
                      >
                        <SelectTrigger id="report-accuracy">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="accurate">Accurate</SelectItem>
                          <SelectItem value="partially_accurate">
                            Partially accurate
                          </SelectItem>
                          <SelectItem value="incorrect">Incorrect</SelectItem>
                          <SelectItem value="needs_more_evidence">
                            Needs more evidence
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="report-feedback-notes">
                        Notes (optional)
                      </Label>
                      <Textarea
                        id="report-feedback-notes"
                        maxLength={2000}
                        value={feedbackNotes}
                        onChange={(event) =>
                          setFeedbackNotes(event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rejected-hypotheses">
                        Rejected hypotheses (optional, one per line)
                      </Label>
                      <Textarea
                        id="rejected-hypotheses"
                        aria-describedby="rejected-hypotheses-help"
                        aria-invalid={rejectedHypothesesInvalid}
                        maxLength={3009}
                        value={rejectedHypotheses}
                        onChange={(event) =>
                          setRejectedHypotheses(event.target.value)
                        }
                      />
                      <p
                        id="rejected-hypotheses-help"
                        className={
                          rejectedHypothesesInvalid
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {rejectedHypothesisValues.length} of 10 hypotheses. Each
                        may contain up to 300 characters.
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={saveFeedback}
                      disabled={isSavingReport || rejectedHypothesesInvalid}
                    >
                      {isSavingReport && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Save feedback
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    You have read-only access to this snapshot.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
