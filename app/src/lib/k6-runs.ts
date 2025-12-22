"use client";

export type K6RunStatus = "running" | "passed" | "failed" | "error";

export type K6RunDetails = {
  status: string;
  runStatus: string | null;
  reportS3Url: string | null;
  runReportUrl: string | null;
  summaryS3Url: string | null;
  consoleS3Url: string | null;
  summaryJson: Record<string, unknown> | null;
  thresholdsPassed: boolean | null;
  totalRequests: number | null;
  failedRequests: number | null;
  requestRate: number | null;
  avgResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  p99ResponseTimeMs: number | null;
  errorDetails: string | null;
  consoleOutput: string | null;
  location: string | null;
  startedAt: string | null;
  completedAt: string | null;
  testTitle: string | null;
};

export const statusLabelMap: Record<K6RunStatus, string> = {
  running: "Running performance test…",
  passed: "Test completed",
  failed: "Test failed",
  error: "Execution error",
};

export const toDisplayStatus = (
  status: string | null | undefined,
): K6RunStatus => {
  if (!status) {
    return "running";
  }
  const normalized = status.toLowerCase();
  if (normalized === "passed" || normalized === "completed") {
    return "passed";
  }
  if (normalized === "failed") {
    return "failed";
  }
  // Error status (includes cancellations which are stored as 'error')
  if (normalized === "error") {
    return "error";
  }
  return "running";
};


export async function fetchK6RunDetails(
  runId: string,
): Promise<K6RunDetails | null> {
  const res = await fetch(`/api/k6/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  return {
    status: data.status ?? data.runStatus ?? "running",
    runStatus: data.runStatus ?? data.status ?? null,
    reportS3Url: data.reportS3Url ?? null,
    runReportUrl: data.runReportUrl ?? null,
    summaryS3Url: data.summaryS3Url ?? null,
    consoleS3Url: data.consoleS3Url ?? null,
    summaryJson: data.summaryJson ?? null,
    thresholdsPassed: data.thresholdsPassed ?? null,
    totalRequests: data.totalRequests ?? null,
    failedRequests: data.failedRequests ?? null,
    requestRate: data.requestRate ?? null,
    avgResponseTimeMs: data.avgResponseTimeMs ?? null,
    p95ResponseTimeMs: data.p95ResponseTimeMs ?? null,
    p99ResponseTimeMs: data.p99ResponseTimeMs ?? null,
    errorDetails: data.errorDetails ?? null,
    consoleOutput: data.consoleOutput ?? null,
    location: data.location ?? null,
    startedAt: data.startedAt ?? null,
    completedAt: data.completedAt ?? null,
    testTitle: data.testTitle ?? null,
  };
}
