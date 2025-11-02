"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Separator } from "@/components/ui/separator";
import { ReportViewer } from "@/components/shared/report-viewer";
import { K6Logo } from "@/components/logo/k6-logo";
import {
  fetchK6RunDetails,
  statusLabelMap,
  toDisplayStatus,
  type K6RunDetails,
  type K6RunStatus,
} from "@/lib/k6-runs";
import { ConsoleViewer } from "@/components/k6/console-viewer";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface PerformanceTestReportProps {
  runId: string;
  onStatusChange?: (
    status: K6RunStatus,
    payload?: { reportUrl?: string; location?: string | null; duration?: string }
  ) => void;
}

const statusIconMap: Record<K6RunStatus, ReactElement> = {
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  passed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  error: <AlertTriangle className="h-4 w-4 text-amber-500" />,
};
export function PerformanceTestReport({
  runId,
  onStatusChange,
}: PerformanceTestReportProps) {
  const [status, setStatus] = useState<K6RunStatus>("running");
  const [consoleBuffer, setConsoleBuffer] = useState<string>("");
  const [runDetails, setRunDetails] = useState<K6RunDetails | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [shouldStream, setShouldStream] = useState(false);

  // Keep a ref to the latest onStatusChange callback
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Reset state when runId changes
  useEffect(() => {
    setStatus("running");
    setConsoleBuffer("");
    setRunDetails(null);
    setStreamError(null);
    setIsInitializing(true);
    setShouldStream(false);
  }, [runId]);

  // Fetch initial run details to determine if test is already complete
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const details = await fetchK6RunDetails(runId);
        if (details) {
          setRunDetails(details);
          const derivedStatus = toDisplayStatus(details.runStatus ?? details.status);
          setStatus(derivedStatus);

          // If test is already complete, don't set up streaming
          const isComplete = derivedStatus !== "running";
          const hasReport = details.reportS3Url || details.runReportUrl;

          if (isComplete && hasReport) {
            // Test is complete with report available - skip streaming
            setShouldStream(false);
            const reportHref = `/api/test-results/${encodeURIComponent(runId)}/index.html?forceIframe=true`;
            onStatusChangeRef.current?.(derivedStatus, {
              reportUrl: reportHref,
              location: details.location ?? null,
              duration: computeDuration(details),
            });
          } else if (derivedStatus === "running") {
            // Test is still running - set up streaming
            setShouldStream(true);
          } else if (!hasReport) {
            // Test complete but no report yet - stream will be set up to get final results
            setShouldStream(true);
          }
        } else {
          // Failed to get details - assume still running and set up streaming
          setShouldStream(true);
        }
      } catch (err) {
        console.error("Failed to check initial k6 run status:", err);
        // On error, assume test might still be running and set up streaming
        setShouldStream(true);
      } finally {
        setIsInitializing(false);
      }
    };

    checkInitialStatus();
  }, [runId]);

  const computeDuration = (details: K6RunDetails): string | undefined => {
    if (!details.startedAt || !details.completedAt) return undefined;
    const start = Date.parse(details.startedAt);
    const end = Date.parse(details.completedAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return undefined;
    }
    const seconds = Math.round((end - start) / 1000);
    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;
      return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
    }
    if (seconds === 0) {
      return "<1s";
    }
    if (seconds > 0) {
      return `${seconds}s`;
    }
    return undefined;
  };

  useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

  const handleCompletion = useCallback(
    async (finalStatus: string) => {
      const displayStatus = toDisplayStatus(finalStatus);
      setStatus(displayStatus);

      try {
        // Fetch run details with retry logic for better reliability
        let details: K6RunDetails | null = null;
        let retries = 0;
        const maxRetries = 5;
        const retryDelay = 500; // Start with 500ms

        while (retries < maxRetries && !details) {
          try {
            details = await fetchK6RunDetails(runId);
            if (details && details.reportS3Url) {
              break; // Report is ready, no need to retry
            }
          } catch (err) {
            console.error(`Retry ${retries + 1}/${maxRetries} failed:`, err);
          }

          if (!details) {
            retries++;
            if (retries < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, retryDelay * retries)
              );
            }
          }
        }

        if (details) {
          setRunDetails(details);
          const derivedStatus = toDisplayStatus(details.runStatus ?? details.status);
          setStatus(derivedStatus);
          const reportHref =
            details.reportS3Url || details.runReportUrl
              ? `/api/test-results/${encodeURIComponent(runId)}/index.html?forceIframe=true`
              : undefined;
          onStatusChangeRef.current?.(derivedStatus, {
            reportUrl: reportHref,
            location: details.location ?? null,
            duration: computeDuration(details),
          });
        } else {
          console.warn("Could not fetch k6 run details after retries");
          onStatusChangeRef.current?.(displayStatus);
        }
      } catch (err) {
        console.error("Failed to load k6 run details", err);
        onStatusChangeRef.current?.(displayStatus);
      }
    },
    [runId]
  );

  useEffect(() => {
    // Only set up streaming if we determined the test is still running or needs to be checked
    if (!shouldStream || isInitializing) {
      return;
    }

    const source = new EventSource(
      `/api/runs/${encodeURIComponent(runId)}/stream`
    );

    const onConsole = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.line) {
          setConsoleBuffer((prev) => prev + payload.line);
        }
      } catch (err) {
        console.error("Failed to parse console payload", err);
      }
    };

    const onComplete = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        handleCompletion(payload?.status ?? "completed");
      } catch (err) {
        console.error("Failed to parse completion payload", err);
        handleCompletion("error");
      } finally {
        source.close();
      }
    };

    source.addEventListener("console", onConsole);
    source.addEventListener("complete", onComplete);
    source.onerror = () => {
      setStreamError("Connection lost. Attempting to finalize results…");
      source.close();
      handleCompletion("error");
    };

    return () => {
      source.removeEventListener("console", onConsole);
      source.removeEventListener("complete", onComplete);
      source.close();
    };
  }, [handleCompletion, runId, shouldStream, isInitializing]);

  const reportUrl = useMemo(() => {
    if (!runDetails) return null;
    if (runDetails.reportS3Url || runDetails.runReportUrl) {
      return `/api/test-results/${encodeURIComponent(
        runId,
      )}/index.html?forceIframe=true`;
    }
    return null;
  }, [runDetails, runId]);

  const summaryDownloadUrl = useMemo(() => {
    if (!runDetails?.summaryS3Url) return null;
    return `/api/test-results/${encodeURIComponent(
      runId,
    )}/summary.json`;
  }, [runDetails, runId]);

  const showLiveConsole = status === "running";
  const showFallbackConsole = !showLiveConsole && !reportUrl;
  const fullscreenHeader = useMemo(() => {
    return (
      <>
        <K6Logo width={36} height={36} />
        <h2 className="text-xl font-semibold">k6 Performance Report</h2>
      </>
    );
  }, []);

  // Show loading state while initializing
  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">Loading report…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {showLiveConsole ? (
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {statusIconMap[status]}
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {statusLabelMap[status]}
              </span>
              {runDetails?.location ? (
                <span className="text-xs text-muted-foreground">
                  Location: {runDetails.location}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Run ID: <span className="font-mono">{runId}</span>
          </div>
        </div>
      ) : null}

      {streamError ? (
        <div className="bg-amber-50 px-4 py-2 text-xs text-amber-700">
          {streamError}
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden">
        {showLiveConsole || showFallbackConsole ? (
          <div className="flex h-full flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {showLiveConsole ? "Live Console Output" : "Console Output"}
              </h3>
              {!showLiveConsole && summaryDownloadUrl ? (
                <a
                  href={summaryDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Download summary JSON
                </a>
              ) : null}
            </div>
            <Separator className="mt-2" />
            <ConsoleViewer
              content={
                runDetails?.consoleOutput && !showLiveConsole
                  ? runDetails.consoleOutput
                  : consoleBuffer
              }
            />
          </div>
        ) : reportUrl ? (
          <ReportViewer
            reportUrl={reportUrl}
            containerClassName="h-full w-full relative"
            iframeClassName="h-full w-full border-0 rounded-none"
            hideEmptyMessage
            hideReloadButton
            fullscreenHeader={fullscreenHeader}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Report not available.
          </div>
        )}
      </div>
    </div>
  );
}
