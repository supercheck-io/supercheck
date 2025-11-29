"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Skeleton } from "./ui/skeleton";
import { ExecutionsDialog } from "./executions/executions-dialog";

// Define our queue stats interface here for reference
interface QueueStats {
  running: number;
  runningCapacity: number;
  queued: number;
  queuedCapacity: number;
}

export function ParallelThreads() {
  const [stats, setStats] = useState<QueueStats>({
    running: 0,
    runningCapacity: 2, // Default value, will be updated from SSE
    queued: 0,
    queuedCapacity: 10, // Default value, will be updated from SSE
  });
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected"
  >("connecting");
  const [activeDialogTab, setActiveDialogTab] = useState<"running" | "queued" | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Function to create and set up the SSE connection
  const setupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const source = new EventSource("/api/queue-stats/sse");
      eventSourceRef.current = source;

      source.onopen = () => {
        setConnectionStatus("connected");
        reconnectAttemptsRef.current = 0;
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setStats(data);
          setLoading(false);
          setConnectionStatus("connected");
        } catch (err) {
          console.error("Error parsing SSE data:", err);
        }
      };

      source.onerror = () => {
        // Only change connection status if we're not already trying to reconnect
        if (connectionStatus !== "connecting") {
          setConnectionStatus("connecting");
        }

        // Close the current connection
        source.close();
        eventSourceRef.current = null;

        // Implement exponential backoff for reconnection
        const backoffTime = Math.min(
          1000 * Math.pow(1.5, reconnectAttemptsRef.current),
          10000
        );
        reconnectAttemptsRef.current++;

        // Clear any existing timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        // Schedule reconnection
        reconnectTimeoutRef.current = setTimeout(() => {
          if (document.visibilityState !== "hidden") {
            setupEventSource();
          }
        }, backoffTime);
      };

      return source;
    } catch (err) {
      console.error("Failed to initialize SSE:", err);
      setConnectionStatus("disconnected");
      return null;
    }
  }, [connectionStatus]);

  useEffect(() => {
    // Set up visibility change listener to reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !eventSourceRef.current) {
        setupEventSource();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial setup
    const source = setupEventSource();

    // Cleanup function
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (source) {
        source.close();
      }
    };
  }, [setupEventSource]);

  // Calculate progress percentages
  const runningProgress = Math.min(
    100,
    (stats.running / stats.runningCapacity) * 100
  );
  const queuedProgress = Math.min(
    100,
    (stats.queued / stats.queuedCapacity) * 100
  );

  if (loading) {
    return <LoadingSkeleton />;
  }

  // Just show the data even if we're reconnecting - the user doesn't need to know about temporary connectivity issues
  return (
    <>
      <div
        className="flex items-center mr-2 border border-border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors group"
        onClick={() => setActiveDialogTab("running")}
        title="Click to manage parallel executions"
      >
        <div className="flex items-center text-[11px]">
          <div className="flex flex-col mr-3 text-[10px] font-semibold text-muted-foreground leading-tight">
            <span>PARALLEL</span>
            <span>EXECUTIONS</span>
          </div>

          <div className="flex flex-col mr-4">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`font-medium text-[10px] ${stats.running > 0
                  ? "text-blue-600 dark:text-blue-500"
                  : "text-muted-foreground"
                  }`}
              >
                RUNNING
              </span>
              <span className="text-muted-foreground ml-2 text-[10px]">
                {stats.running}/{stats.runningCapacity}
              </span>
            </div>
            <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-in-out"
                style={{ width: `${runningProgress}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`font-medium text-[10px] ${stats.queued > 0
                  ? "text-amber-600 dark:text-amber-500"
                  : "text-muted-foreground"
                  }`}
              >
                QUEUED
              </span>
              <span className="text-muted-foreground ml-2 text-[10px]">
                {stats.queued}/{stats.queuedCapacity}
              </span>
            </div>
            <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 rounded-full transition-all duration-500 ease-in-out"
                style={{ width: `${queuedProgress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <ExecutionsDialog
        open={activeDialogTab !== null}
        onOpenChange={(open) => !open && setActiveDialogTab(null)}
        defaultTab={activeDialogTab || "running"}
      />
    </>
  );
}

// Loading skeleton for parallel executions component
function LoadingSkeleton() {
  return (
    <div className="flex items-center mr-2 border border-border rounded-md px-3 py-1.5">
      <div className="flex items-center text-[11px]">
        <div className="flex flex-col mr-3 text-[10px] font-semibold text-muted-foreground leading-tight">
          <span>PARALLEL</span>
          <span>EXECUTIONS</span>
        </div>

        <div className="flex flex-col mr-4">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-[10px] text-muted-foreground">RUNNING</span>
            <Skeleton className="h-3 w-8 ml-2" />
          </div>
          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
            <Skeleton className="h-full w-full opacity-20" />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-[10px] text-muted-foreground">QUEUED</span>
            <Skeleton className="h-3 w-8 ml-2" />
          </div>
          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
            <Skeleton className="h-full w-full opacity-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
