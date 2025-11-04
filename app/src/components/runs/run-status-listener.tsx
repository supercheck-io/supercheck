"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface RunStatusListenerProps {
  runId: string;
  status: string;
  onStatusUpdate?: (
    status: string,
    reportUrl?: string,
    duration?: string
  ) => void;
}

export function RunStatusListener({
  runId,
  status,
  onStatusUpdate,
}: RunStatusListenerProps) {
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasShownToastRef = useRef<boolean>(false);
  const loadingToastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    // Clean up any existing loading toast when unmounting
    return () => {
      if (loadingToastIdRef.current) {
        toast.dismiss(loadingToastIdRef.current);
        loadingToastIdRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // If the run is already in a terminal state, don't set up SSE
    if (
      status === "completed" ||
      status === "failed" ||
      status === "passed" ||
      status === "error"
    ) {
      // Dismiss any existing loading toast
      if (loadingToastIdRef.current) {
        toast.dismiss(loadingToastIdRef.current);
        loadingToastIdRef.current = null;
      }

      return;
    }

    // Do not show loading toast - handled by JobContext
    // Clean up function
    const cleanupSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    // Establish SSE connection to global job status events
    // This listens for status updates for this specific runId

    const eventSource = new EventSource(`/api/job-status/events`);
    eventSourceRef.current = eventSource;

    // Reset toast flag on new connection
    hasShownToastRef.current = false;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Filter: Only process events for this specific runId
        if (data.runId !== runId) {
          return;
        }

        // Notify parent component of status updates - now with duration
        if (data.status && onStatusUpdate) {
          onStatusUpdate(data.status, data.s3Url, data.duration);
        }

        // Handle terminal statuses
        if (
          (data.status === "completed" ||
            data.status === "failed" ||
            data.status === "passed" ||
            data.status === "error") &&
          !hasShownToastRef.current
        ) {
          // First dismiss the loading toast if it exists
          if (loadingToastIdRef.current) {
            toast.dismiss(loadingToastIdRef.current);
            loadingToastIdRef.current = null;
          }

          // Mark as shown to prevent duplicates
          hasShownToastRef.current = true;

          // No toast notifications here - handled by JobContext

          // Close SSE connection after terminal status
          cleanupSSE();

          // Refresh page data to show updated statuses
          setTimeout(() => router.refresh(), 500);
        }
      } catch (error) {
        console.error(`[RunStatusListener] Error parsing message:`, error);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`[RunStatusListener] SSE error:`, error);
      // Dismiss the loading toast on error
      if (loadingToastIdRef.current) {
        toast.dismiss(loadingToastIdRef.current);
        loadingToastIdRef.current = null;
      }
      cleanupSSE();
    };

    // Clean up on unmount
    return () => {
      // Dismiss the loading toast when unmounting
      if (loadingToastIdRef.current) {
        toast.dismiss(loadingToastIdRef.current);
        loadingToastIdRef.current = null;
      }
      cleanupSSE();
    };
  }, [runId, status, onStatusUpdate, router]);

  // Component doesn't render anything visible
  return null;
}
