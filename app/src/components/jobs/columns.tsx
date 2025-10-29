import type { ColumnDef } from "@tanstack/react-table";
import { TimerIcon, Loader2, Zap, Clock } from "lucide-react";
import { useRef, useCallback, useEffect } from "react";

import type { Job } from "./schema";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useJobContext, JobStatusDisplay } from "./job-context";
import { UUIDField } from "@/components/ui/uuid-field";
import { useProjectContext } from "@/hooks/use-project-context";
import { canTriggerJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

// Type definition for the extended meta object used in this table
interface JobsTableMeta {
  onDeleteJob?: (id: string) => void;
  globalFilterColumns?: string[];
  // Include other potential properties from the base TableMeta if needed
}

// Separate component for name with popover
function NameWithPopover({ name }: { name: string }) {
  return (
    <div className="flex space-x-2">
      <TruncatedTextWithTooltip
        text={name}
        className="font-medium"
        maxWidth="160px"
        maxLength={20}
      />
    </div>
  );
}

// Separate component for description with popover
function DescriptionWithPopover({
  description,
}: {
  description: string | null;
}) {
  const displayText = description || "No description provided";

  return (
    <TruncatedTextWithTooltip
      text={displayText}
      className=""
      maxWidth="200px"
      maxLength={30}
    />
  );
}

// Create a proper React component for the run button
function RunButton({ job }: { job: Job }) {
  const { isJobRunning, setJobRunning, startJobRun } = useJobContext();
  const { currentProject } = useProjectContext();
  const eventSourceRef = useRef<EventSource | null>(null);

  // Get job running state from global context
  const isRunning = isJobRunning(job.id);

  // Check if user has permission to trigger jobs
  const hasPermission = currentProject?.userRole
    ? canTriggerJobs(normalizeRole(currentProject.userRole))
    : false;

  // Cleanup function to handle SSE connection close
  const closeSSEConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      closeSSEConnection();
    };
  }, [closeSSEConnection]);

  const handleRunJob = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // Prevent row click event
    e.preventDefault(); // Prevent opening the sheet

    // Only prevent execution if this specific job is running or user lacks permission
    if (isRunning || !hasPermission) {
      return;
    }

    try {
      // Close any existing SSE connection first
      closeSSEConnection();

      // Set just this job as running
      setJobRunning(true, job.id);

      if (!job.tests || job.tests.length === 0) {
        toast.error("Cannot run job", {
          description: "This job has no tests associated with it.",
        });
        // Reset state if returning early
        setJobRunning(false, job.id);
        return;
      }

      // Prepare the test data
      const testData = job.tests.map((test) => ({
        id: test.id,
        name: test.name || "",
        title: test.name || "",
      }));

      // Call the API endpoint for running jobs
      const response = await fetch("/api/jobs/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: job.id,
          tests: testData,
          trigger: "manual", // Add trigger value
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Handle the error directly without throwing
        let errorMessage = "Unknown error";

        if (response.status === 429) {
          errorMessage =
            "Queue capacity limit reached. Please try again later.";
        } else {
          // Use the original error message but trim it to be more concise
          errorMessage = errorText.replace("Failed to run job: ", "");

          // Limit the length of the error message
          if (errorMessage.length > 100) {
            errorMessage = errorMessage.substring(0, 100) + "...";
          }
        }

        toast.error("Error running job", {
          description: errorMessage,
        });

        setJobRunning(false, job.id);
        return; // Exit early without throwing
      }

      const data = await response.json();

      if (data.runId) {
        // Use the global job context to manage toast notifications and SSE
        startJobRun(data.runId, job.id, job.name);
      } else {
        // No runId received, something is wrong
        toast.error("Error running job", {
          description: "Failed to get run ID for the job.",
        });
        setJobRunning(false, job.id);
      }
    } catch (error) {
      console.error("[RunButton] Error running job:", error);

      // This catch block now only handles network errors, parsing errors, etc.
      // HTTP errors are handled above
      let errorMessage = "Network error occurred while running the job.";

      if (error instanceof Error) {
        errorMessage = error.message;

        // Limit the length of the error message
        if (errorMessage.length > 100) {
          errorMessage = errorMessage.substring(0, 100) + "...";
        }
      }

      toast.error("Error running job", {
        description: errorMessage,
      });

      setJobRunning(false, job.id);
    }
  };

  return (
    <Button
      onClick={handleRunJob}
      size="sm"
      variant="default"
      className={cn(
        "bg-[hsl(212,83%,53%)] hover:bg-[hsl(212,83%,48%)] dark:bg-[hsl(221,83%,53%)] dark:hover:bg-[hsl(221,83%,48%)]",
        "text-white",
        "flex items-center justify-center",
        "h-7 px-1 rounded-md",
        "gap-2",
        "cursor-pointer",
        "ml-1"
      )}
      disabled={
        isRunning || !job.tests || job.tests.length === 0 || !hasPermission
      }
      title={
        !hasPermission
          ? "Insufficient permissions to trigger jobs"
          : isRunning
          ? "Job is currently running"
          : !job.tests || job.tests.length === 0
          ? "No tests available to run"
          : "Run job"
      }
    >
      {isRunning ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Running...</span>
        </>
      ) : (
        <>
          <Zap className="h-4 w-4" />
          <span className="text-xs">Run</span>
        </>
      )}
    </Button>
  );
}

export const columns: ColumnDef<Job>[] = [
  {
    id: "run",
    header: () => <div className="ml-2">Trigger</div>,
    cell: ({ row }) => {
      const job = row.original;
      return <RunButton job={job} />;
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Job ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;

      return (
        <div className="w-[90px]">
          <UUIDField
            value={id}
            maxLength={24}
            onCopy={() => toast.success("ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const name = row.getValue("name") as string;

      return <NameWithPopover name={name} />;
    },
  },
  {
    accessorKey: "description",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Description" />
    ),
    cell: ({ row }) => {
      const description = row.getValue("description") as string | null;

      return <DescriptionWithPopover description={description} />;
    },
  },
  {
    accessorKey: "cronSchedule",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Schedule" />
    ),
    cell: ({ row }) => {
      const cronSchedule = row.getValue("cronSchedule") as string | null;
      return (
        <div className="flex items-center max-w-[120px]">
          <TimerIcon
            className={`${
              cronSchedule ? "text-sky-500" : "text-muted-foreground"
            } mr-2 h-4 w-4 flex-shrink-0`}
          />
          <span
            className={`${
              cronSchedule ? "text-foreground" : "text-muted-foreground"
            } truncate`}
          >
            {cronSchedule || "None"}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const jobId = row.getValue("id") as string;
      const dbStatus = row.getValue("status") as string;

      return <JobStatusDisplay jobId={jobId} dbStatus={dbStatus} />;
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "lastRunAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last Run" />
    ),
    cell: ({ row }) => {
      const lastRunAt = row.getValue("lastRunAt") as string | null;
      if (!lastRunAt) {
        return <div className="text-muted-foreground">Never</div>;
      }
      return (
        <div className="flex flex-col">
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground self-center" />
            <div className="flex items-center">
              <span>
                {new Date(lastRunAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <span className="text-muted-foreground ml-1 text-xs">
              {new Date(lastRunAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "nextRunAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Next Run" />
    ),
    cell: ({ row }) => {
      const nextRunAt = row.getValue("nextRunAt") as string | null;
      const cronSchedule = row.getValue("cronSchedule") as string | null;

      if (!cronSchedule || !nextRunAt) {
        return <div className="text-muted-foreground">Never</div>;
      }

      return (
        <div className="flex flex-col">
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground self-center" />
            <div className="flex items-center">
              <span>
                {new Date(nextRunAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <span className="text-muted-foreground ml-1 text-xs">
              {new Date(nextRunAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => {
      const createdAt = row.getValue("createdAt") as string;
      if (!createdAt) return null;

      const date = new Date(createdAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      return (
        <div className="flex items-center w-[170px]">
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">
            {formattedTime}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated" />
    ),
    cell: ({ row }) => {
      const updatedAt = row.getValue("updatedAt") as string;
      const createdAt = row.getValue("createdAt") as string;

      // Only show updatedAt if it's different from createdAt (indicating an actual update)
      if (!updatedAt || updatedAt === createdAt) {
        return (
          <div className="flex items-center w-[170px]">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-sm">Not updated</span>
          </div>
        );
      }

      const date = new Date(updatedAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      return (
        <div className="flex items-center w-[170px]">
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">
            {formattedTime}
          </span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      // Explicitly cast table.options.meta to the extended type
      const meta = table.options.meta as JobsTableMeta | undefined;
      const onDeleteCallback = meta?.onDeleteJob;

      return (
        <DataTableRowActions
          row={row}
          onDelete={
            onDeleteCallback
              ? () => onDeleteCallback(row.original.id)
              : undefined
          }
        />
      );
    },
  },
];
