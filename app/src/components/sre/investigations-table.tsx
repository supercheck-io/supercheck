"use client";

import { useState, useTransition } from "react";
import { FileSearch } from "lucide-react";
import { toast } from "sonner";

import { createSreInvestigationReportSnapshot, saveSreInvestigationReportFeedback } from "@/actions/sre-investigation-reports";
import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { DataTable } from "./data-table/data-table";
import { columns } from "./data-table/investigations/columns";
import { InvestigationsToolbar } from "./data-table/investigations/toolbar";

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

  const reviewingItem = investigations.find((item) => item.id === reviewingRunId) ?? null;

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardHeader className="border-b bg-muted/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-2xl font-semibold">
              Investigation history
            </CardTitle>
            <CardDescription>
              Search SRE agent runs and export sanitized report JSON with evidence, tool hashes, recommendations, and raw payloads excluded.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 space-y-4">
        {investigations.length === 0 ? (
          <DashboardEmptyState
            icon={<FileSearch className="h-10 w-10 text-muted-foreground" />}
            title="No investigations recorded yet"
            description="Run an incident investigation to capture evidence, recommendations, cost, and report exports here."
            className="min-h-[360px]"
          />
        ) : (
          <div className="flex flex-col">
            <DataTable
              columns={columns}
              data={investigations}
              renderToolbar={(table) => <InvestigationsToolbar table={table} />}
              entityLabel="investigations"
              meta={{
                onSnapshot: saveSnapshot,
                onReview: openReview,
                onExport: downloadInvestigation,
                savedSnapshotIds,
                feedbackByRunId,
                pendingSnapshotRunId,
                isSnapshotPending,
                globalFilterColumns: ["incidentTitle", "rootCauseHypothesis", "serviceName", "severity", "modelId", "status", "agentType"]
              }}
            />
            {reviewingItem && (
              <div className="mt-4 rounded-2xl border bg-muted/20 p-4">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
