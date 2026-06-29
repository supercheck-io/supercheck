"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Archive, Download, FileSearch, MessageSquareText, Search } from "lucide-react";
import { toast } from "sonner";

import { createSreInvestigationReportSnapshot, saveSreInvestigationReportFeedback } from "@/actions/sre-investigation-reports";
import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type SreInvestigationsTableProps = {
  investigations: SreInvestigationHistoryItem[];
  loadError?: string | null;
};

type ReportFeedbackAccuracy = NonNullable<SreInvestigationHistoryItem["reportFeedbackAccuracy"]>;

type FeedbackState = {
  accuracy: ReportFeedbackAccuracy | null;
  rejectedHypothesisCount: number;
  updatedAt: string | null;
};

type FeedbackDraft = {
  accuracy: ReportFeedbackAccuracy;
  notes: string;
  rejectedHypothesesText: string;
};

const feedbackAccuracyLabels: Record<ReportFeedbackAccuracy, string> = {
  accurate: "Accurate",
  partially_accurate: "Partially accurate",
  incorrect: "Incorrect",
  needs_more_evidence: "Needs more evidence",
};

function formatDuration(durationMs: number | null) {
  if (durationMs == null) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCost(costCents: number | null) {
  if (costCents == null) {
    return "-";
  }

  return `$${(costCents / 100).toFixed(2)}`;
}

function formatFeedbackBadge(feedback: FeedbackState | undefined) {
  if (!feedback?.accuracy) {
    return null;
  }

  const rejectedSuffix = feedback.rejectedHypothesisCount > 0 ? ` · ${feedback.rejectedHypothesisCount} rejected` : "";
  return `${feedbackAccuracyLabels[feedback.accuracy]}${rejectedSuffix}`;
}

function downloadInvestigation(item: SreInvestigationHistoryItem) {
  const payload = item.reportExport ?? item;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sre-investigation-report-${item.id}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SreInvestigationsTable({ investigations, loadError = null }: SreInvestigationsTableProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [agentType, setAgentType] = useState("all");
  const [savedSnapshotIds, setSavedSnapshotIds] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(investigations.map((item) => [item.id, item.reportSnapshotId]))
  );
  const [feedbackByRunId, setFeedbackByRunId] = useState<Record<string, FeedbackState>>(() =>
    Object.fromEntries(
      investigations.map((item) => [
        item.id,
        {
          accuracy: item.reportFeedbackAccuracy,
          rejectedHypothesisCount: item.reportRejectedHypothesisCount,
          updatedAt: item.reportFeedbackUpdatedAt?.toISOString() ?? null,
        },
      ])
    )
  );
  const [reviewingRunId, setReviewingRunId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>({
    accuracy: "partially_accurate",
    notes: "",
    rejectedHypothesesText: "",
  });
  const [pendingSnapshotRunId, setPendingSnapshotRunId] = useState<string | null>(null);
  const [isSnapshotPending, startSnapshotTransition] = useTransition();
  const [isFeedbackPending, startFeedbackTransition] = useTransition();
  const hasActiveFilters = Boolean(query.trim()) || status !== "all" || agentType !== "all";

  const filteredInvestigations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return investigations.filter((item) => {
      const matchesStatus = status === "all" || item.status === status;
      const matchesAgentType = agentType === "all" || item.agentType === agentType;
      const searchable = [
        item.incidentTitle,
        item.rootCauseHypothesis,
        item.serviceName,
        item.severity,
        item.modelId,
        item.status,
        item.agentType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && matchesAgentType && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [agentType, investigations, query, status]);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>SRE investigations unavailable</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  const saveSnapshot = (item: SreInvestigationHistoryItem) => {
    setPendingSnapshotRunId(item.id);
    startSnapshotTransition(async () => {
      const result = await createSreInvestigationReportSnapshot({ investigationRunId: item.id });
      setPendingSnapshotRunId(null);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setSavedSnapshotIds((current) => ({ ...current, [item.id]: result.snapshotId }));
      toast.success(result.reused ? "Report snapshot already saved" : "Report snapshot saved");
    });
  };

  const openReview = (item: SreInvestigationHistoryItem) => {
    const existingFeedback = feedbackByRunId[item.id];
    setReviewingRunId(item.id);
    setFeedbackDraft({
      accuracy: existingFeedback?.accuracy ?? "partially_accurate",
      notes: "",
      rejectedHypothesesText: "",
    });
  };

  const saveFeedback = (item: SreInvestigationHistoryItem) => {
    const reportSnapshotId = savedSnapshotIds[item.id];
    if (!reportSnapshotId) {
      toast.error("Save a report snapshot before reviewing it");
      return;
    }

    const rejectedHypotheses = feedbackDraft.rejectedHypothesesText
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);

    startFeedbackTransition(async () => {
      const result = await saveSreInvestigationReportFeedback({
        reportSnapshotId,
        accuracy: feedbackDraft.accuracy,
        notes: feedbackDraft.notes,
        rejectedHypotheses,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setFeedbackByRunId((current) => ({
        ...current,
        [item.id]: {
          accuracy: result.accuracy,
          rejectedHypothesisCount: result.rejectedHypothesisCount,
          updatedAt: result.updatedAt,
        },
      }));
      setReviewingRunId(null);
      toast.success("Report review saved");
    });
  };

  const reviewingItem = filteredInvestigations.find((item) => item.id === reviewingRunId) ?? null;

  return (
    <Card className="rounded-3xl">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <FileSearch className="h-5 w-5" />
              Investigation history
            </CardTitle>
            <CardDescription>
              Search SRE agent runs and export sanitized report JSON with evidence, tool hashes, recommendations, and raw payloads excluded.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit rounded-full">{filteredInvestigations.length} visible</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search service, root cause, severity, model..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="timed_out">Timed out</SelectItem>
              <SelectItem value="aborted">Aborted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={agentType} onValueChange={setAgentType}>
            <SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              <SelectItem value="triage">Triage</SelectItem>
              <SelectItem value="investigation">Investigation</SelectItem>
              <SelectItem value="background">Background</SelectItem>
              <SelectItem value="sre_ai">SRE AI</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setAgentType("all");
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </Button>
        </div>

        {reviewingItem && (
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-medium">Review saved report</p>
                <p className="text-xs text-muted-foreground">
                  Capture responder feedback and rejected hypotheses for future SRE evals and report quality tuning.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setReviewingRunId(null)}>
                Cancel
              </Button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="sre-report-feedback-accuracy">Accuracy</Label>
                <Select
                  value={feedbackDraft.accuracy}
                  onValueChange={(value) =>
                    setFeedbackDraft((current) => ({ ...current, accuracy: value as ReportFeedbackAccuracy }))
                  }
                >
                  <SelectTrigger id="sre-report-feedback-accuracy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(feedbackAccuracyLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sre-report-rejected-hypotheses">Rejected hypotheses</Label>
                <Textarea
                  id="sre-report-rejected-hypotheses"
                  value={feedbackDraft.rejectedHypothesesText}
                  onChange={(event) =>
                    setFeedbackDraft((current) => ({ ...current, rejectedHypothesesText: event.target.value }))
                  }
                  placeholder="One rejected hypothesis per line"
                  className="min-h-20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sre-report-feedback-notes">Notes</Label>
                <Textarea
                  id="sre-report-feedback-notes"
                  value={feedbackDraft.notes}
                  onChange={(event) => setFeedbackDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="What was missing, useful, or misleading?"
                  className="min-h-20"
                />
              </div>
              <Button type="button" onClick={() => saveFeedback(reviewingItem)} disabled={isFeedbackPending}>
                Save review
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvestigations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    {hasActiveFilters ? "No SRE investigations match the current filters." : "No SRE investigations have been recorded yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredInvestigations.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[360px]">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.incidentId ? (
                            <Link href={`/incidents/${item.incidentId}`} className="font-medium hover:underline">
                              {item.incidentNumber ? `#${item.incidentNumber} ` : ""}{item.incidentTitle ?? "Untitled incident"}
                            </Link>
                          ) : (
                            <span className="font-medium">Unscoped investigation</span>
                          )}
                          <Badge variant="outline" className="capitalize">{item.agentType}</Badge>
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {item.rootCauseHypothesis ?? "No root-cause summary captured yet."}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "completed" ? "secondary" : "outline"} className="capitalize">
                        {item.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.serviceName ?? "-"}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {item.evidenceCount} evidence
                        <p className="text-xs text-muted-foreground">{item.toolCallCount} tools · {item.recommendationCount} recs</p>
                        {savedSnapshotIds[item.id] && <Badge variant="outline" className="mt-1 rounded-full">snapshot saved</Badge>}
                        {formatFeedbackBadge(feedbackByRunId[item.id]) && (
                          <Badge variant="secondary" className="mt-1 rounded-full">
                            {formatFeedbackBadge(feedbackByRunId[item.id])}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.modelId}</TableCell>
                    <TableCell>{formatDuration(item.durationMs)}</TableCell>
                    <TableCell>{formatCost(item.estimatedCostCents)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => saveSnapshot(item)}
                          disabled={isSnapshotPending && pendingSnapshotRunId === item.id}
                        >
                          <Archive className="h-4 w-4" />
                          Save snapshot
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openReview(item)}
                          disabled={!savedSnapshotIds[item.id]}
                          title={!savedSnapshotIds[item.id] ? "Save a snapshot before reviewing" : undefined}
                        >
                          <MessageSquareText className="h-4 w-4" />
                          Review
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => downloadInvestigation(item)}>
                          <Download className="h-4 w-4" />
                          Export report
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
