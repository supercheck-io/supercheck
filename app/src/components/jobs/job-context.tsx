"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { jobStatuses } from "./data";

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
}: {
  jobId: string;
  dbStatus: string;
}) {
  const { isJobRunning, getJobStatus } = useJobContext();
  const [effectiveStatus, setEffectiveStatus] = useState(dbStatus);

  // Determine status priority: running > context status > db status
  useEffect(() => {
    if (isJobRunning(jobId)) {
      setEffectiveStatus("running");
    } else {
      const contextStatus = getJobStatus(jobId);
      setEffectiveStatus(contextStatus || dbStatus);
    }
  }, [jobId, dbStatus, isJobRunning, getJobStatus]);

  const statusInfo =
    jobStatuses.find((status) => status.value === effectiveStatus) ||
    jobStatuses[0];

  const StatusIcon = statusInfo.icon;

  return (
    <div className="flex w-[120px] items-center">
      <StatusIcon className={`mr-2 h-4 w-4 ${statusInfo.color}`} />
      <span>{statusInfo.label}</span>
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
  const router = useRouter();
  const initializedRef = useRef(false);

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
      setActiveRuns((prev) => ({
        ...prev,
        [jobId]: { runId, jobId, jobName },
      }));

      // Close existing SSE connection for this job if any
      if (eventSourcesRef.current.has(jobId)) {
        eventSourcesRef.current.get(jobId)?.close();
        eventSourcesRef.current.delete(jobId);
      }

      // Set up SSE to get real-time job status
      const eventSource = new EventSource(`/api/job-status/events/${runId}`);
      eventSourcesRef.current.set(jobId, eventSource);

      // Flag to track if we've shown the final toast for this run
      let hasShownFinalToastForRun = false;

      eventSource.onmessage = (event) => {
        try {
          const statusData = JSON.parse(event.data);

          // Handle terminal statuses with final toast
          if (
            (statusData.status === "completed" ||
              statusData.status === "failed" ||
              statusData.status === "passed" ||
              statusData.status === "error") &&
            !hasShownFinalToastForRun
          ) {
            // Only show the toast once for this run
            hasShownFinalToastForRun = true;

            // Update the job status
            setJobStatus(jobId, statusData.status);

            // Determine if job passed or failed
            const passed =
              statusData.status === "completed" ||
              statusData.status === "passed";

            // Clean up resources
            if (eventSourcesRef.current.has(jobId)) {
              eventSourcesRef.current.get(jobId)?.close();
              eventSourcesRef.current.delete(jobId);
            }

            // Remove from active runs
            setActiveRuns((prev) => {
              const newRuns = { ...prev };
              delete newRuns[jobId];
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

            // Show completion toast
            toast[passed ? "success" : "error"](
              passed ? "Job execution passed" : "Job execution failed",
              {
                description: (
                  <>
                    {jobName}:{" "}
                    {passed
                      ? "All tests executed successfully."
                      : "One or more tests did not complete successfully."}{" "}
                    <a
                      href={`/runs/${runId}`}
                      className="underline font-medium"
                    >
                      View Run Report
                    </a>
                  </>
                ),
                duration: 10000,
              }
            );

            // Refresh the page
            router.refresh();
          }
        } catch (e) {
          console.error("[JobContext] Error parsing SSE event:", e);
        }
      };

      eventSource.onerror = (error) => {
        console.error(
          "[JobContext] SSE connection error for job",
          jobId,
          ":",
          error
        );

        if (!hasShownFinalToastForRun) {
          hasShownFinalToastForRun = true;

          // Clean up resources
          if (eventSourcesRef.current.has(jobId)) {
            eventSourcesRef.current.get(jobId)?.close();
            eventSourcesRef.current.delete(jobId);
          }

          // Set error status
          setJobStatus(jobId, "error");

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
            return newRuns;
          });

          // Show error toast
          toast.error(`Job execution error for ${jobName}`, {
            description:
              "Connection to job status updates was lost. Check job status in the runs page.",
          });

          // Refresh the page
          router.refresh();
        }
      };

      // Update the global running state
      setIsAnyJobRunning(true);
    },
    [router, setJobStatus]
  );

  // Check for running jobs on initial load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Function to fetch running jobs from the server
    const checkForRunningJobs = async () => {
      try {
        // Fetch all currently running jobs via an API endpoint
        const response = await fetch("/api/jobs/status/running");

        if (!response.ok) {
          console.error("[JobContext] Failed to fetch running jobs");
          return;
        }

        const data = await response.json();
        const runningJobsData = data.runningJobs || [];

        if (runningJobsData.length === 0) {
          return; // No running jobs
        }

        // Update our running jobs tracking
        const newRunningJobs = new Set<string>();
        const newJobStatuses: JobStatuses = {};

        // Update job statuses and running jobs set
        runningJobsData.forEach(
          (job: { jobId: string; runId: string; name: string }) => {
            newRunningJobs.add(job.jobId);
            newJobStatuses[job.jobId] = "running";

            // Set up SSE for this job's run
            startJobRun(job.runId, job.jobId, job.name);
          }
        );

        // Update state
        if (newRunningJobs.size > 0) {
          setRunningJobs(newRunningJobs);
          setJobStatuses((prev) => ({ ...prev, ...newJobStatuses }));
          setIsAnyJobRunning(true);
        }
      } catch (error) {
        console.error("[JobContext] Error checking for running jobs:", error);
      }
    };

    // Call the function to check for running jobs
    checkForRunningJobs();
  }, [startJobRun]);

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

  const setJobRunning = (isRunning: boolean, jobId?: string) => {
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
          return newRuns;
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

        // Close all event sources
        eventSourcesRef.current.forEach((eventSource) => {
          eventSource.close();
        });
        eventSourcesRef.current.clear();
      }
    }
  };

  const completeJobRun = (success: boolean, jobId: string, runId: string) => {
    // This can be called manually if needed
    if (!activeRuns[jobId]) return;

    // Get job info
    const jobInfo = activeRuns[jobId];

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
      return newRuns;
    });

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
            <a href={`/runs/${runId}`} className="underline font-medium">
              View Run Report
            </a>
          </>
        ),
        duration: 10000,
      }
    );

    // Refresh the page
    router.refresh();
  };

  return (
    <JobContext.Provider
      value={{
        isAnyJobRunning,
        runningJobs,
        isJobRunning,
        getJobStatus,
        setJobRunning,
        setJobStatus,
        activeRuns,
        startJobRun,
        completeJobRun,
      }}
    >
      {children}
    </JobContext.Provider>
  );
}

export function useJobContext() {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error("useJobContext must be used within a JobProvider");
  }
  return context;
}
