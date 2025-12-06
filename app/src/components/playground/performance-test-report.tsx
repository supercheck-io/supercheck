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
import {
  Loader2,
  Terminal,
  Download,
  ChartSpline,
  WifiOff,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const HEARTBEAT_STALE_THRESHOLD_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 15_000;

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
  const [completedConsoleLog, setCompletedConsoleLog] = useState<string | null>(
    null
  );
  const [consoleFetchState, setConsoleFetchState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");

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
    setCompletedConsoleLog(null);
    setConsoleFetchState("idle");
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
          if (derivedStatus !== "running") {
            setShouldStream(false);
          }

          // If test is already complete, don't set up streaming
          const isComplete = derivedStatus !== "running";
          const hasReport = details.reportS3Url || details.runReportUrl;

          if (isComplete && hasReport) {
            // Test is complete with report available - skip streaming and switch to report tab
            setShouldStream(false);
            setActiveTab("report");
            const reportHref = `/api/test-results/${encodeURIComponent(
              runId
            )}/report/report.html?forceIframe=true`;
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

  const fetchCompletedConsole = useCallback(async () => {
    if (consoleFetchState === "loading" || consoleFetchState === "loaded") {
      return;
    }

    setConsoleFetchState("loading");
    try {
      const endpoints = [
        `/api/test-results/${encodeURIComponent(runId)}/console.log?ts=${Date.now()}&archived=true`,
        `/api/test-results/${encodeURIComponent(runId)}/console.log?ts=${Date.now()}`,
      ];

      let fetched = false;
      for (const url of endpoints) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) {
            continue;
          }
          const text = await response.text();
          setCompletedConsoleLog(text);
          setConsoleFetchState("loaded");
          fetched = true;
          break;
        } catch {
          // try next endpoint
        }
      }

      if (!fetched) {
        throw new Error("Console fetch failed");
      }
    } catch (error) {
      console.error("Failed to fetch completed console log", error);
      setConsoleFetchState("error");
    }
  }, [consoleFetchState, runId]);

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
            )}/report/report.html?forceIframe=true`
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
    if (!shouldStream && status !== "running" && consoleFetchState === "idle") {
      void fetchCompletedConsole();
    }
  }, [shouldStream, status, consoleFetchState, fetchCompletedConsole]);

  useEffect(() => {
    // Only set up streaming if we determined the test is still running or needs to be checked
    if (!shouldStream || isInitializing) {
      return;
    }

    let isActive = true;
    let reconnectAttempts = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let currentCleanup: (() => void) | null = null;
    let heartbeatWatchdog: ReturnType<typeof setInterval> | null = null;
    let lastHeartbeatAt = Date.now();

    const clearReconnectTimeout = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const stopHeartbeatWatchdog = () => {
      if (heartbeatWatchdog) {
        clearInterval(heartbeatWatchdog);
        heartbeatWatchdog = null;
      }
    };

    const recordHeartbeat = () => {
      lastHeartbeatAt = Date.now();
    };

    const startHeartbeatWatchdog = () => {
      if (heartbeatWatchdog) {
        return;
      }
      heartbeatWatchdog = setInterval(() => {
        if (!isActive) {
          return;
        }
        if (Date.now() - lastHeartbeatAt > HEARTBEAT_STALE_THRESHOLD_MS) {
          recordHeartbeat();
          cleanupSource();
          scheduleReconnect(true);
        }
      }, HEARTBEAT_CHECK_INTERVAL_MS);
    };

    const cleanupSource = () => {
      if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
      }
      stopHeartbeatWatchdog();
    };

    const pollRunStatus = async () => {
      try {
        const details = await fetchK6RunDetails(runId);
        if (!details) {
          return;
        }

        const derivedStatus = toDisplayStatus(
          details.runStatus ?? details.status
        );

        if (derivedStatus !== "running") {
          // We reached a terminal state while the stream was down.
          isActive = false;
          clearReconnectTimeout();
          cleanupSource();
          setStreamError(null);
          await handleCompletion(
            details.runStatus ?? details.status ?? derivedStatus
          );
        }
      } catch (err) {
        console.error("Failed to poll run status after stream error", err);
      }
    };

    const scheduleReconnect = (dueToStaleness = false) => {
      if (!isActive) {
        return;
      }

      reconnectAttempts += 1;
      const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
      const prefix = dueToStaleness ? "Connection stale." : "Connection lost.";

      setStreamError(
        reconnectAttempts === 1
          ? `${prefix} Attempting to reconnect…`
          : `${prefix} Retrying (attempt ${reconnectAttempts})…`
      );

      clearReconnectTimeout();
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, delay);

      if (reconnectAttempts % 3 === 0) {
        // Periodically poll run status so we still surface completion state
        void pollRunStatus();
      }
    };

    const connect = () => {
      if (!isActive) {
        return;
      }

      cleanupSource();

      const source = new EventSource(
        `/api/runs/${encodeURIComponent(runId)}/stream`
      );
      recordHeartbeat();
      startHeartbeatWatchdog();

      const onOpen = () => {
        reconnectAttempts = 0;
        setStreamError(null);
        recordHeartbeat();
      };

      const onConsole = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.line) {
            setStreamError(null);
            setConsoleBuffer((prev) => prev + payload.line);
            recordHeartbeat();
          }
        } catch (err) {
          console.error("Failed to parse console payload", err);
        }
      };

      const onComplete = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          isActive = false;
          clearReconnectTimeout();
          cleanupSource();
          stopHeartbeatWatchdog();
          setShouldStream(false);
          void handleCompletion(payload?.status ?? "completed");
        } catch (err) {
          console.error("Failed to parse completion payload", err);
          isActive = false;
          clearReconnectTimeout();
          cleanupSource();
          stopHeartbeatWatchdog();
          setShouldStream(false);
          void handleCompletion("error");
        }
      };

      const onError = () => {
        if (!isActive) {
          return;
        }

        // If the browser is still trying to reconnect we do not want to close the source.
        if (source.readyState === EventSource.CONNECTING) {
          setStreamError("Connection interrupted. Reconnecting…");
          return;
        }

        cleanupSource();
        scheduleReconnect();
      };

      const onHeartbeat = () => {
        recordHeartbeat();
      };

      source.addEventListener("open", onOpen);
      source.addEventListener("console", onConsole as EventListener);
      source.addEventListener("complete", onComplete as EventListener);
      source.addEventListener("error", onError as EventListener);
      source.addEventListener("heartbeat", onHeartbeat as EventListener);

      currentCleanup = () => {
        source.removeEventListener("open", onOpen);
        source.removeEventListener("console", onConsole as EventListener);
        source.removeEventListener("complete", onComplete as EventListener);
        source.removeEventListener("error", onError as EventListener);
        source.removeEventListener("heartbeat", onHeartbeat as EventListener);
        source.close();
      };
    };

    connect();

    return () => {
      isActive = false;
      clearReconnectTimeout();
      cleanupSource();
      stopHeartbeatWatchdog();
    };
  }, [handleCompletion, runId, shouldStream, isInitializing]);

  const reportUrl = useMemo(() => {
    if (!runDetails) return null;
    if (runDetails.reportS3Url || runDetails.runReportUrl) {
      return `/api/test-results/${encodeURIComponent(
        runId
      )}/report/report.html?forceIframe=true`;
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
            className={`h-10 ${reportUrl ? "w-60" : "w-32"} grid ${reportUrl ? "grid-cols-2" : "grid-cols-1"
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
            {streamError && (
              <div className="absolute top-16 left-4 right-4 z-10">
                <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                  <WifiOff className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>{streamError}</span>
                    <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>Reconnecting…</span>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {status !== "running" && consoleFetchState === "loading" ? (
              <div className="absolute top-20 left-30 right-30 z-10">
                <Alert className="border-muted bg-muted/95 text-muted-foreground shadow-sm">
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />
                  <AlertTitle className="text-sm font-medium">
                    Loading logs
                  </AlertTitle>
                  <AlertDescription>
                    Loading full log from artifact storage…
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}
            {status !== "running" && consoleFetchState === "error" ? (
              <div className="absolute top-20 left-30 right-30 z-10">
                <Alert className="border-muted bg-muted/95 text-muted-foreground shadow-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                  <AlertTitle className="text-sm font-medium">
                    Logs not fully available
                  </AlertTitle>
                  <AlertDescription className="text-sm">
                    Execution may have been cancelled by user or the system encountered an issue while saving the log.
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}

            {/* Console Output - Full Height */}
            <MonacoConsoleViewer
              content={
                status === "running"
                  ? consoleBuffer
                  : completedConsoleLog ||
                  runDetails?.consoleOutput ||
                  consoleBuffer
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
              isK6Report={true}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
