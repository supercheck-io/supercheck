"use client";

import { MarkdownReportDialog } from "@/components/shared/markdown-report-dialog";

interface AIK6AnalyzeViewerProps {
  open: boolean;
  onClose: () => void;
  content: string;
  isStreaming: boolean;
  baselineRunId: string;
  compareRunId: string;
  jobName?: string;
}

export function AIK6AnalyzeViewer({
  open,
  onClose,
  content,
  isStreaming,
  baselineRunId,
  compareRunId,
  jobName,
}: AIK6AnalyzeViewerProps) {
  return (
    <MarkdownReportDialog
      open={open}
      onClose={onClose}
      content={content}
      isStreaming={isStreaming}
      title="k6 Performance Comparison Analysis"
      description={`${jobName ? `${jobName} • ` : ""}Baseline: ${baselineRunId.substring(0, 8)} → Compare: ${compareRunId.substring(0, 8)}`}
      downloadFilename={`k6-comparison-${baselineRunId.substring(0, 8)}-vs-${compareRunId.substring(0, 8)}.md`}
      loadingMessage="Generating analysis..."
    />
  );
}
