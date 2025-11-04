"use client";

import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { runStatuses } from "./data";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface JobStatusProps {
  runId: string;
  initialStatus: string;
}

export function JobStatus({ runId, initialStatus }: JobStatusProps) {
  const [status, setStatus] = useState(initialStatus);
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasShownToastRef = useRef<boolean>(false);
  const lastStatusRef = useRef<string>(initialStatus);

  useEffect(() => {
    // Only set up SSE if the job is not in a terminal state
    if (["completed", "failed", "passed", "error"].includes(initialStatus)) {
      setStatus(initialStatus);
      return;
    }

    // Clean up function
    const cleanupSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    // Create new EventSource connection
    const eventSource = new EventSource(`/api/job-status/events/${runId}`);
    eventSourceRef.current = eventSource;

    // Reset toast flag on new connection
    hasShownToastRef.current = false;
    lastStatusRef.current = initialStatus;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status) {
          const newStatus = data.status;
          // Update the displayed status
          setStatus(newStatus);

          // Handle status change with toast notifications
          const isTerminalStatus = [
            "completed",
            "passed",
            "failed",
            "error",
          ].includes(newStatus);
          const isStatusChange = lastStatusRef.current !== newStatus;

          // Update our tracking of last status
          lastStatusRef.current = newStatus;

          // Show toast for terminal status changes if we haven't shown one already
          if (isTerminalStatus && isStatusChange && !hasShownToastRef.current) {
            // Mark that we've shown a toast to prevent duplicates
            hasShownToastRef.current = true;

            // Determine if job passed or failed
            const passed = newStatus === "completed" || newStatus === "passed";

            // Show toast message for status change
            toast[passed ? "success" : "error"](
              passed ? "Job execution passed" : "Job execution failed",
              {
                description: passed
                  ? "All tests executed successfully."
                  : `One or more tests failed. ${data.error || ""}`,
                duration: 5000,
              }
            );

            // Close the connection after terminal status
            cleanupSSE();

            // Refresh the page data to show updated job statuses
            setTimeout(() => {
              router.refresh();
            }, 500);
          }
        }
      } catch (error) {
        console.error(`[JobStatus] Error parsing SSE message:`, error);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`[JobStatus] SSE error:`, error);
      cleanupSSE();
    };

    // Clean up on unmount
    return cleanupSSE;
  }, [runId, initialStatus, router]);

  // Find the status object based on current status
  const statusInfo =
    runStatuses.find((s) => s.value === status) || runStatuses[0];
  const StatusIcon = statusInfo.icon;

  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 ${statusInfo.color}`}
    >
      <StatusIcon className="h-3 w-3" />
      <span>{statusInfo.label}</span>
    </Badge>
  );
}
