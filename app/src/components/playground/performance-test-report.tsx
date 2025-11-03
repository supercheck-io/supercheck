"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ReportViewer } from "@/components/shared/report-viewer";
import { K6Logo } from "@/components/logo/k6-logo";
import {
  fetchK6RunDetails,
  toDisplayStatus,
  type K6RunDetails,
  type K6RunStatus,
} from "@/lib/k6-runs";
import { MonacoConsoleViewer } from "@/components/k6/monaco-console-viewer";
import { Loader2, Terminal, Download, ChartSpline } from "lucide-react";

interface PerformanceTestReportProps {
  runId: string;
  onStatusChange?: (
    status: K6RunStatus,
    payload?: {
      reportUrl?: string;
      location?: string | null;
      duration?: string;
    }
  ) => void;
}
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
  const [activeTab, setActiveTab] = useState<"logs" | "report">("logs");

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
    setActiveTab("logs");
  }, [runId]);

  // Fetch initial run details to determine if test is already complete
  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const details = await fetchK6RunDetails(runId);
        if (details) {
          setRunDetails(details);
          const derivedStatus = toDisplayStatus(
            details.runStatus ?? details.status
          );
          setStatus(derivedStatus);

          // If test is already complete, don't set up streaming
          const isComplete = derivedStatus !== "running";
          const hasReport = details.reportS3Url || details.runReportUrl;

          if (isComplete && hasReport) {
            // Test is complete with report available - skip streaming and switch to report tab
            setShouldStream(false);
            setActiveTab("report");
            const reportHref = `/api/test-results/${encodeURIComponent(
              runId
            )}/index.html?forceIframe=true`;
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
          const derivedStatus = toDisplayStatus(
            details.runStatus ?? details.status
          );
          setStatus(derivedStatus);
          const hasReport = details.reportS3Url || details.runReportUrl;
          const reportHref = hasReport
            ? `/api/test-results/${encodeURIComponent(
                runId
              )}/index.html?forceIframe=true`
            : undefined;

          // Switch to report tab if report is available
          if (hasReport) {
            setActiveTab("report");
          }

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
        runId
      )}/index.html?forceIframe=true`;
    }
    return null;
  }, [runDetails, runId]);

  const summaryDownloadUrl = useMemo(() => {
    if (!runDetails?.summaryS3Url) return null;
    return `/api/test-results/${encodeURIComponent(runId)}/summary.json`;
  }, [runDetails, runId]);

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
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading report…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-background">
      {/* Tabs Section */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "logs" | "report")}
        className="h-full w-full"
      >
        {/* Tab Headers - Absolute Positioned with proper shadcn styling */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <TabsList
            className={`h-10 ${reportUrl ? "w-60" : "w-32"} grid ${
              reportUrl ? "grid-cols-2" : "grid-cols-1"
            } shadow-lg`}
          >
            <TabsTrigger
              value="logs"
              className="flex items-center justify-center gap-2"
            >
              <Terminal className="h-4 w-4" />
              <span>Logs</span>
            </TabsTrigger>
            {reportUrl && (
              <TabsTrigger
                value="report"
                className="flex items-center justify-center gap-2"
              >
                <ChartSpline className="h-4 w-4" />
                <span>Summary</span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Download JSON Button - Bottom Right */}
        {status !== "running" && summaryDownloadUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute bottom-4 right-4 z-10 h-9 w-9 shadow-md bg-background/80 backdrop-blur-sm hover:bg-background/90"
            onClick={() => {
              const link = document.createElement("a");
              link.href = summaryDownloadUrl;
              link.download = `k6-summary-${runId}.json`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            title="Download JSON Summary"
          >
            <Download className="h-4 w-4" />
          </Button>
        )}

        {/* Logs Tab */}
        <TabsContent value="logs" className="h-full w-full m-0 p-0">
          <div className="h-full w-full flex flex-col">
            {/* Stream Error Alert */}
            {streamError ? (
              <div className="absolute top-16 left-4 right-4 z-10 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 rounded-md shadow-lg">
                {streamError}
              </div>
            ) : null}

            {/* Console Output - Full Height */}
            <MonacoConsoleViewer
              content={
                runDetails?.consoleOutput && status !== "running"
                  ? runDetails.consoleOutput
                  : consoleBuffer
              }
              className="rounded-none border-0"
            />
          </div>
        </TabsContent>

        {/* Report Tab */}
        {reportUrl && (
          <TabsContent value="report" className="h-full w-full m-0 p-0">
            <ReportViewer
              reportUrl={reportUrl}
              containerClassName="h-full w-full"
              iframeClassName="h-full w-full border-0"
              hideEmptyMessage
              hideReloadButton
              fullscreenHeader={fullscreenHeader}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
