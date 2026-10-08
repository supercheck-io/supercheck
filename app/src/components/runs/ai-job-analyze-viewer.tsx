"use client";

import { MarkdownReportDialog } from "@/components/shared/markdown-report-dialog";

interface AIJobAnalyzeViewerProps {
  open: boolean;
  onClose: () => void;
  content: string;
  isStreaming: boolean;
  runId: string;
  jobName: string;
  jobType: string;
}

export function AIJobAnalyzeViewer({
  open,
  onClose,
  content,
  isStreaming,
  runId,
  jobName,
  jobType,
}: AIJobAnalyzeViewerProps) {
  const formatJobType = (type: string) => {
    const labels: Record<string, string> = {
      k6: "K6 Performance Test",
      playwright: "Playwright Test",
    };
    return labels[type] || type;
  };

  return (
    <MarkdownReportDialog
      open={open}
      onClose={onClose}
      content={content}
      isStreaming={isStreaming}
      title="Job Run Analysis"
      description={`${jobName} • ${formatJobType(jobType)} • Run: ${runId.substring(0, 8)}`}
      downloadFilename={`job-analysis-${runId.substring(0, 8)}.md`}
      loadingMessage="Generating analysis..."
    />
  );
}
