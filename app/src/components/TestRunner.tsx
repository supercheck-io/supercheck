"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
// Assume Editor component exists for code input
// import Editor from '@/components/Editor';

// Define interface for the status response from the new API endpoint
interface RunStatus {
  runId: string;
  jobId?: string; // For jobs
  status: "pending" | "running" | "passed" | "failed";
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  errorDetails?: string;
  reportUrl?: string; // This will be the S3 URL
}

export default function TestRunner() {
  const [code, setCode] = useState<string>(
    "// Add your Playwright script here\n"
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [pollingIntervalId, setPollingIntervalId] =
    useState<NodeJS.Timeout | null>(null);

  // Function to poll for run status
  const pollStatus = useCallback(
    async (currentRunId: string) => {
      try {
        const res = await fetch(`/api/runs/${currentRunId}/status`);
        if (!res.ok) {
          // Handle 404 or other errors - stop polling if run not found after a few tries?
          const errorData = await res.json();
          console.error("Polling error:", res.status, errorData.error);
          // Maybe stop polling after a few 404s?
          if (res.status === 404) {
            setError(`Run ${currentRunId} not found.`);
            // Consider stopping polling here
          }
          // Don't update status if fetch failed
          return;
        }
        const data: RunStatus = await res.json();
        setRunStatus(data);

        // Stop polling if the run is completed (passed or failed)
        if (data.status === "passed" || data.status === "failed") {
          if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            setPollingIntervalId(null);
          }
          setIsLoading(false);
          setRunId(null); // Reset runId after completion? Optional.
        }
      } catch (err) {
        console.error("Error polling status:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch status");
        // Potentially stop polling on fetch errors
        if (pollingIntervalId) clearInterval(pollingIntervalId);
        setPollingIntervalId(null);
        setIsLoading(false);
      }
    },
    [pollingIntervalId]
  ); // Dependency on pollingIntervalId to clear it

  // Effect to start/stop polling when runId changes
  useEffect(() => {
    if (runId && !pollingIntervalId) {
      // Poll immediately first
      pollStatus(runId);
      // Then set interval
      const intervalId = setInterval(() => pollStatus(runId), 3000); // Poll every 3 seconds
      setPollingIntervalId(intervalId);

      // Cleanup function to stop polling
      return () => {
        clearInterval(intervalId);
        setPollingIntervalId(null);
      };
    } else if (!runId && pollingIntervalId) {
      // Clear interval if runId becomes null
      clearInterval(pollingIntervalId);
      setPollingIntervalId(null);
    }
    // Explicitly disable exhaustive-deps check if pollStatus causes re-renders,
    // but ensure pollStatus itself has stable dependencies or is wrapped in useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollStatus]); // Add pollStatus to dependency array

  const handleRunTest = async () => {
    setIsLoading(true);
    setError(null);
    setRunStatus(null);
    setRunId(null); // Clear previous run ID
    if (pollingIntervalId) {
      // Clear any existing interval
      clearInterval(pollingIntervalId);
      setPollingIntervalId(null);
    }

    try {
      const response = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: code }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to queue test");
      }

      // Test queued successfully, save the runId to start polling
      setRunId(result.runId || result.testId);
      // isLoading remains true while polling
    } catch (err) {
      console.error("Error running script:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
      setIsLoading(false);
    }
  };

  return (
    <div>
      {/* <Editor value={code} onChange={setCode} /> */}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={15}
        style={{
          width: "100%",
          fontFamily: "monospace",
          border: "1px solid #ccc",
          marginBottom: "10px",
        }}
      />
      <Button onClick={handleRunTest} disabled={isLoading}>
        {isLoading ? "Running..." : "Run Test"}
      </Button>

      {isLoading && runId && (
        <p>
          Executing Script (Run ID: {runId})... Status:{" "}
          {runStatus?.status || "pending"}
        </p>
      )}

      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {runStatus &&
        (runStatus.status === "passed" || runStatus.status === "failed") && (
          <div>
            <h3>Run Completed</h3>
            <p>Status: {runStatus.status}</p>
            {runStatus.errorDetails && <p>Details: {runStatus.errorDetails}</p>}
            {runStatus.reportUrl ? (
              <a
                href={runStatus.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Report (S3 Link)
              </a>
            ) : (
              <p>(Report URL not available)</p>
            )}
          </div>
        )}
    </div>
  );
}
