"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { jobStatuses } from "./data";
import { RUNS_QUERY_KEY } from "@/hooks/use-runs";
import { getExecutionsData } from "@/hooks/use-executions";
interface JobStatusSSEPayload {
  status: string;
  jobId?: string;
  runId?: string;
  queue?: string;
  hasJobId?: boolean;
  [key: string]: unknown;
}

interface JobRunState {
  runId: string;
  jobId: string;
  jobName: string;
}

// Simple map to track job statuses within the session
interface JobStatuses {
  [jobId: string]: string;
}

// Map to track active runs for each job
interface ActiveRunsMap {
  [jobId: string]: JobRunState;
}

interface JobContextType {
  isAnyJobRunning: boolean;
  runningJobs: Set<string>;
  isJobRunning: (jobId: string) => boolean;
  getJobStatus: (jobId: string) => string | null;
  setJobRunning: (isRunning: boolean, jobId?: string) => void;
  setJobStatus: (jobId: string, status: string) => void;
  activeRuns: ActiveRunsMap;
  startJobRun: (runId: string, jobId: string, jobName: string) => void;
  completeJobRun: (success: boolean, jobId: string, runId: string) => void;
}

const JobContext = createContext<JobContextType | undefined>(undefined);

// React component to display job status by reading from context
export function JobStatusDisplay({
  jobId,
  dbStatus,
  lastRunErrorDetails,
}: {
  jobId: string;
  dbStatus: string;
  lastRunErrorDetails?: string | null;
}) {
  const { isJobRunning, getJobStatus } = useJobContext();

  // Compute effective status directly - no need for useState/useEffect
  // Determine status priority: running > context status > db status
  const computeEffectiveStatus = (): string => {
    if (isJobRunning(jobId)) {
      return "running";
    }

    const contextStatus = getJobStatus(jobId);
    // Use context status if available (especially for terminal statuses)
    // Otherwise fall back to db status
    let statusToUse = contextStatus || dbStatus;

    // Check if this is a cancelled run (status is error but errorDetails contains cancellation)
    if (statusToUse === "error" && lastRunErrorDetails) {
      const lowerErrorDetails = lastRunErrorDetails.toLowerCase();
      if (
        lowerErrorDetails.includes("cancellation") ||
        lowerErrorDetails.includes("cancelled")
      ) {
        statusToUse = "cancelled";
      }
    }

    return statusToUse || "pending";
  };

  const displayStatus = computeEffectiveStatus();

  const statusInfo =
    jobStatuses.find((status) => status.value === displayStatus) ||
    jobStatuses.find((status) => status.value === "pending");

  const StatusIcon = statusInfo?.icon || jobStatuses[0].icon;

  return (
    <div className="flex w-[120px] items-center">
      <StatusIcon
        className={`mr-2 h-4 w-4 ${statusInfo?.color || jobStatuses[0].color}`}
      />
      <span>{statusInfo?.label || jobStatuses[0].label}</span>
    </div>
  );
}

export function JobProvider({ children }: { children: React.ReactNode }) {
  const [isAnyJobRunning, setIsAnyJobRunning] = useState(false);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  // Simple in-memory job status tracking (not persisted)
  const [jobStatuses, setJobStatuses] = useState<JobStatuses>({});
  const [activeRuns, setActiveRuns] = useState<ActiveRunsMap>({});
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const activeRunsRef = useRef<ActiveRunsMap>({});
  const globalEventSourceRef = useRef<EventSource | null>(null);
  const runToJobMapRef = useRef<
    Map<string, { jobId: string; jobName?: string }>
  >(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const queryClient = useQueryClient();

  // Check if a specific job is running
  const isJobRunning = useCallback(
    (jobId: string): boolean => {
      return runningJobs.has(jobId);
    },
    [runningJobs]
  );

  // Get the status of a job from context
  const getJobStatus = useCallback(
    (jobId: string): string | null => {
      return jobStatuses[jobId] || null;
    },
    [jobStatuses]
  );

  // Set the status of a job in context
  const setJobStatus = useCallback((jobId: string, status: string) => {
    setJobStatuses((prev) => ({
      ...prev,
      [jobId]: status,
    }));

    // If status is running, add to running jobs
    if (status === "running") {
      setRunningJobs((prev) => {
        const newSet = new Set(prev);
        newSet.add(jobId);
        return newSet;
      });
      setIsAnyJobRunning(true);
    }
    // If status is terminal, remove from running jobs
    else if (["passed", "failed", "error", "completed"].includes(status)) {
      setRunningJobs((prev) => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        if (newSet.size === 0) {
          setIsAnyJobRunning(false);
        }
        return newSet;
      });
    }
  }, []);

  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  // Define startJobRun as a useCallback before it's used in useEffect
  const startJobRun = useCallback(
    (runId: string, jobId: string, jobName: string) => {
      // Mark this job as running
      setRunningJobs((prev) => {
        const newSet = new Set(prev);
        newSet.add(jobId);
        return newSet;
      });

      // Update job status
      setJobStatus(jobId, "running");

      // Add this run to the active runs map
      setActiveRuns((prev) => {
        const updated = {
          ...prev,
          [jobId]: { runId, jobId, jobName },
        };
        activeRunsRef.current = updated;
        return updated;
      });

      runToJobMapRef.current.set(runId, { jobId, jobName });

      // Close existing SSE connection for this job if any
      if (eventSourcesRef.current.has(jobId)) {
        eventSourcesRef.current.get(jobId)?.close();
        eventSourcesRef.current.delete(jobId);
      }

      // Note: We rely on the global /api/job-status/events connection
      // set up in the useEffect below, not a per-job connection
      // Individual job events are filtered by runId in handleGlobalJobEvent

      // Update the global running state
      setIsAnyJobRunning(true);
    },
    [setJobStatus]
  );

  const handleGlobalJobEvent = useCallback(
    (payload: JobStatusSSEPayload) => {
      const runId =
        typeof payload.runId === "string" ? payload.runId : undefined;
      if (!runId || !payload?.status) {
        return;
      }

      const mapped = runToJobMapRef.current.get(runId);
      const jobId =
        mapped?.jobId ||
        (typeof payload.jobId === "string" ? payload.jobId : runId);
      const status = String(payload.status).toLowerCase();

      if (status === "running") {
        const current = activeRunsRef.current[jobId];

        if (current && current.runId === runId) {
          setJobStatus(jobId, "running");
          return;
        }

        const jobName =
          mapped?.jobName || activeRunsRef.current[jobId]?.jobName || jobId;

        startJobRun(runId, jobId, jobName);
        return;
      }

      if (
        ["completed", "passed", "failed", "error", "cancelled"].includes(status)
      ) {
        setJobStatus(jobId, payload.status);
        if (activeRunsRef.current[jobId]?.runId === runId) {
          const jobName = activeRunsRef.current[jobId]?.jobName || jobId;
          const passed = status === "completed" || status === "passed";
          const cancelled = status === "cancelled" || status === "error"; // Cancelled status from SSE or error status

          // Remove from active runs
          setActiveRuns((prev) => {
            const newRuns = { ...prev };
            delete newRuns[jobId];
            activeRunsRef.current = newRuns;
            return newRuns;
          });

          // Remove from running jobs
          setRunningJobs((prev) => {
            const newSet = new Set(prev);
            newSet.delete(jobId);
            if (newSet.size === 0) {
              setIsAnyJobRunning(false);
            }
            return newSet;
          });

          runToJobMapRef.current.delete(runId);

          // Only show toast for actual job runs (not playground runs)
          // Use hasJobId field from SSE payload (added to distinguish job vs playground runs)
          const isActualJob = payload.hasJobId === true;

          if (isActualJob) {
            // Show completion toast for job runs only
            let toastType: "success" | "error" | "info" = passed
              ? "success"
              : "error";
            let toastTitle = passed
              ? "Job execution passed"
              : "Job execution failed";
            let toastMessage = passed
              ? "All tests executed successfully."
              : "One or more tests did not complete successfully.";

            if (cancelled) {
              toastType = "info";
              toastTitle = "Job execution cancelled";
              toastMessage = "The job execution was cancelled by a user.";
            }

            toast[toastType](toastTitle, {
              description: (
                <>
                  {jobName}: {toastMessage}{" "}
                  <Link href={`/runs/${runId}`} className="underline font-medium" prefetch={false}>
                    View Run Report
                  </Link>
                </>
              ),
              duration: 10000,
            });
          }

          // Invalidate React Query cache to refresh runs data
          queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY, refetchType: 'all' });
        }
      }
    },
    [setJobStatus, startJobRun, queryClient]
  );

  useEffect(() => {
    let isMounted = true;

    const cleanupGlobalEventSource = () => {
      if (globalEventSourceRef.current) {
        globalEventSourceRef.current.close();
        globalEventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    // PERFORMANCE: Use shared getExecutionsData() to prevent duplicate API calls
    // This function uses module-level cache, so multiple components calling it
    // will share the same cached data within 5 seconds
    const fetchRunningJobs = async () => {
      try {
        const data = await getExecutionsData();
        if (!data) {
          return;
        }

        if (!isMounted) {
          return;
        }

        // Filter to only job executions (not playground) and map to expected format
        const runningJobsData = data.running
          .filter((item) => item.source === 'job' && item.jobId)
          .map((item) => ({
            jobId: item.jobId!,
            runId: item.runId,
            name: item.jobName,
          }));

        runningJobsData.forEach((job) => {
          if (!job?.jobId || !job?.runId) {
            return;
          }

          const current = activeRunsRef.current[job.jobId];

          if (current && current.runId === job.runId) {
            setJobStatus(job.jobId, "running");
            return;
          }

          startJobRun(job.runId, job.jobId, job.name ?? job.jobId);
        });
      } catch (error) {
        if (isMounted) {
          console.error("[JobContext] Error fetching running jobs:", error);
        }
      }
    };

    const connectToGlobalEvents = () => {
      cleanupGlobalEventSource();

      const source = new EventSource("/api/job-status/events");
      globalEventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttemptsRef.current = 0;
        void fetchRunningJobs();
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as JobStatusSSEPayload;
          handleGlobalJobEvent(data);
        } catch (parseError) {
          console.error(
            "[JobContext] Failed to parse job status event:",
            parseError
          );
        }
      };

      source.onerror = () => {
        source.close();
        if (!isMounted) {
          return;
        }

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        reconnectAttemptsRef.current = attempt + 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isMounted) {
            return;
          }
          connectToGlobalEvents();
        }, delay);
      };
    };

    void fetchRunningJobs();
    connectToGlobalEvents();

    return () => {
      isMounted = false;
      cleanupGlobalEventSource();
    };
  }, [handleGlobalJobEvent, setJobStatus, startJobRun]);

  // Clean up event sources on unmount
  useEffect(() => {
    // Create a local variable that holds a reference to the Map
    const currentEventSources = eventSourcesRef.current;

    return () => {
      // Use the captured reference in cleanup
      currentEventSources.forEach((eventSource) => {
        eventSource.close();
      });
      currentEventSources.clear();
    };
  }, []);

  const setJobRunning = useCallback(
    (isRunning: boolean, jobId?: string) => {
      if (isRunning && jobId) {
        // Add job to running jobs
        setRunningJobs((prev) => {
          const newSet = new Set(prev);
          newSet.add(jobId);
          return newSet;
        });
        setIsAnyJobRunning(true);

        // Update job status in context
        setJobStatus(jobId, "running");
      } else if (!isRunning) {
        if (jobId) {
          // Remove specific job from running jobs
          setRunningJobs((prev) => {
            const newSet = new Set(prev);
            newSet.delete(jobId);
            // Update global state if no more jobs are running
            if (newSet.size === 0) {
              setIsAnyJobRunning(false);
            }
            return newSet;
          });

          // Remove the job from active runs
          setActiveRuns((prev) => {
            const newRuns = { ...prev };
            delete newRuns[jobId];
            activeRunsRef.current = newRuns;
            return newRuns;
          });

          runToJobMapRef.current.forEach((meta, runKey) => {
            if (meta.jobId === jobId) {
              runToJobMapRef.current.delete(runKey);
            }
          });

          // Close the event source for this job
          if (eventSourcesRef.current.has(jobId)) {
            eventSourcesRef.current.get(jobId)?.close();
            eventSourcesRef.current.delete(jobId);
          }
        } else {
          // Clear all running jobs
          setRunningJobs(new Set());
          setIsAnyJobRunning(false);

          // Reset all active runs
          setActiveRuns({});
          activeRunsRef.current = {};
          runToJobMapRef.current.clear();

          // Close all event sources
          eventSourcesRef.current.forEach((eventSource) => {
            eventSource.close();
          });
          eventSourcesRef.current.clear();
        }
      }
    },
    [setJobStatus]
  );

  const completeJobRun = useCallback(
    (success: boolean, jobId: string, runId: string) => {
      // This can be called manually if needed
      if (!activeRunsRef.current[jobId]) return;

      // Get job info
      const jobInfo = activeRunsRef.current[jobId];

      // Clean up resources
      if (eventSourcesRef.current.has(jobId)) {
        eventSourcesRef.current.get(jobId)?.close();
        eventSourcesRef.current.delete(jobId);
      }

      // Update job status
      setJobStatus(jobId, success ? "passed" : "failed");

      // Remove from running jobs
      setRunningJobs((prev) => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        if (newSet.size === 0) {
          setIsAnyJobRunning(false);
        }
        return newSet;
      });

      // Remove from active runs
      setActiveRuns((prev) => {
        const newRuns = { ...prev };
        delete newRuns[jobId];
        activeRunsRef.current = newRuns;
        return newRuns;
      });

      runToJobMapRef.current.delete(runId);

      // Show completion toast
      toast[success ? "success" : "error"](
        success ? "Job execution passed" : "Job execution failed",
        {
          description: (
            <>
              {jobInfo.jobName}:{" "}
              {success
                ? "All tests executed successfully."
                : "One or more tests did not complete successfully."}{" "}
              <Link href={`/runs/${runId}`} className="underline font-medium" prefetch={false}>
                View Run Report
              </Link>
            </>
          ),
          duration: 10000,
        }
      );

      // Invalidate React Query cache to refresh runs data
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY, refetchType: 'all' });
    },
    [queryClient, setJobStatus]
  );

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      isAnyJobRunning,
      runningJobs,
      isJobRunning,
      getJobStatus,
      setJobRunning,
      setJobStatus,
      activeRuns,
      startJobRun,
      completeJobRun,
    }),
    [
      isAnyJobRunning,
      runningJobs,
      isJobRunning,
      getJobStatus,
      setJobRunning,
      setJobStatus,
      activeRuns,
      startJobRun,
      completeJobRun,
    ]
  );

  return (
    <JobContext.Provider value={contextValue}>{children}</JobContext.Provider>
  );
}

export function useJobContext() {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error("useJobContext must be used within a JobProvider");
  }
  return context;
}
