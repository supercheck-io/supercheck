"use client";

import { MarkdownReportDialog } from "@/components/shared/markdown-report-dialog";

type AIMonitorAnalyzeViewerProps = {
  open: boolean;
  onClose: () => void;
  content: string;
  isStreaming: boolean;
  monitorId: string;
  monitorName: string;
  monitorType: string;
};

function formatMonitorType(type: string) {
  const typeMap: Record<string, string> = {
    synthetic_test: "Playwright Synthetic",
    http_request: "HTTP Request",
    website: "Website",
    ping_host: "Ping Host",
    port_check: "Port Check",
  };
  return typeMap[type] ?? type;
}

export function AIMonitorAnalyzeViewer({
  open,
  onClose,
  content,
  isStreaming,
  monitorId,
  monitorName,
  monitorType,
}: AIMonitorAnalyzeViewerProps) {
  return (
    <MarkdownReportDialog
      open={open}
      onClose={onClose}
      content={content}
      isStreaming={isStreaming}
      title="Monitor Analysis"
      description={`${monitorName} • ${formatMonitorType(monitorType)}`}
      downloadFilename={`monitor-analysis-${monitorId.substring(0, 8)}.md`}
      loadingMessage="Generating analysis..."
    />
  );
}
