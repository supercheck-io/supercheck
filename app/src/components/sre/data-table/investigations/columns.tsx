"use client";

import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Archive, Download, MessageSquareText, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";

function formatDuration(durationMs: number | null) {
  if (durationMs == null) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCost(costCents: number | null) {
  if (costCents == null) return "-";
  return `$${(costCents / 100).toFixed(2)}`;
}

type ReportFeedbackAccuracy = NonNullable<SreInvestigationHistoryItem["reportFeedbackAccuracy"]>;
type FeedbackState = {
  accuracy: ReportFeedbackAccuracy | null;
  rejectedHypothesisCount: number;
  updatedAt: string | null;
};
const feedbackAccuracyLabels: Record<ReportFeedbackAccuracy, string> = {
  accurate: "Accurate",
  partially_accurate: "Partially accurate",
  incorrect: "Incorrect",
  needs_more_evidence: "Needs more evidence",
};
function formatFeedbackBadge(feedback: FeedbackState | undefined) {
  if (!feedback?.accuracy) return null;
  const rejectedSuffix = feedback.rejectedHypothesisCount > 0 ? ` · ${feedback.rejectedHypothesisCount} rejected` : "";
  return `${feedbackAccuracyLabels[feedback.accuracy]}${rejectedSuffix}`;
}

export const columns: ColumnDef<SreInvestigationHistoryItem>[] = [
  {
    accessorKey: "incidentTitle",
    header: "Incident",
    cell: ({ row }) => {
      const item = row.original;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {item.incidentId ? (
            <Link href={`/incidents/${item.incidentId}`} className="font-medium hover:underline whitespace-nowrap">
              {item.incidentNumber ? `#${item.incidentNumber} ` : ""}{item.incidentTitle ?? "Untitled incident"}
            </Link>
          ) : (
            <span className="font-medium whitespace-nowrap">Unscoped investigation</span>
          )}
        </div>
      );
    }
  },
  {
    id: "rootCause",
    header: "Root Cause",
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.original.rootCauseHypothesis || ""}>
        {row.original.rootCauseHypothesis ?? "No root-cause summary"}
      </div>
    )
  },
  {
    accessorKey: "agentType",
    header: "Agent",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize whitespace-nowrap">
        {row.getValue("agentType")}
      </Badge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <Badge variant={status === "completed" ? "secondary" : "outline"} className="capitalize whitespace-nowrap">
          {status.replace(/_/g, " ")}
        </Badge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "serviceName",
    header: "Service",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.getValue("serviceName") ?? "-"}</span>,
  },
  {
    id: "evidence",
    header: "Evidence",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.evidenceCount}</span>
  },
  {
    id: "tools",
    header: "Tools",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.toolCallCount}</span>
  },
  {
    id: "recs",
    header: "Recs",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.recommendationCount}</span>
  },
  {
    id: "feedback",
    header: "Feedback",
    cell: ({ row, table }) => {
      const item = row.original;
      const meta = table.options.meta as any;
      const feedback = (meta?.feedbackByRunId || {})[item.id];
      const hasSnapshot = !!(meta?.savedSnapshotIds || {})[item.id];

      return (
        <div className="flex flex-col gap-1 min-w-[100px]">
          {hasSnapshot && <Badge variant="outline" className="rounded-full w-fit">snapshot</Badge>}
          {formatFeedbackBadge(feedback) && (
            <Badge variant="secondary" className="rounded-full w-fit whitespace-nowrap">
              {formatFeedbackBadge(feedback)}
            </Badge>
          )}
        </div>
      );
    }
  },
  {
    accessorKey: "modelId",
    header: "Model",
    cell: ({ row }) => <span className="font-mono text-xs">{row.getValue("modelId")}</span>
  },
  {
    accessorKey: "durationMs",
    header: "Duration",
    cell: ({ row }) => formatDuration(row.getValue("durationMs"))
  },
  {
    accessorKey: "estimatedCostCents",
    header: "Cost",
    cell: ({ row }) => formatCost(row.getValue("estimatedCostCents"))
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const item = row.original;
      const meta = table.options.meta as any;
      const hasSnapshot = !!(meta?.savedSnapshotIds || {})[item.id];

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open actions for investigation ${
                item.incidentNumber ? `#${item.incidentNumber}` : item.id
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => meta?.onSnapshot?.(item)} disabled={meta?.isSnapshotPending && meta?.pendingSnapshotRunId === item.id}>
              <Archive className="mr-2 h-4 w-4" /> Save snapshot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => meta?.onReview?.(item)} disabled={!hasSnapshot}>
              <MessageSquareText className="mr-2 h-4 w-4" /> Review
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => meta?.onExport?.(item)}>
              <Download className="mr-2 h-4 w-4" /> Export report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
  }
];
