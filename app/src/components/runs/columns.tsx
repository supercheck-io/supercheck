import type { ColumnDef } from "@tanstack/react-table";
import { CalendarIcon, ClockIcon } from "lucide-react";

import { runStatuses, triggerTypes } from "./data";
import type { TestRun } from "./schema";
import { DataTableColumnHeader } from "../jobs/data-table-column-header";
import { formatDistanceToNow } from "date-fns";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { JobStatus } from "./job-status";
import { DataTableRowActions } from "./data-table-row-actions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Separate component for job name with popover
function JobNameWithPopover({ jobName }: { jobName: string | undefined }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = jobName || "Unknown Job";
  
  // Check if text is likely to be truncated
  const isTruncated = displayName.length > 40;
  
  if (!isTruncated) {
    return (
      <div className="font-medium max-w-[250px] truncate">
        {displayName}
      </div>
    );
  }
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div 
          className="font-medium max-w-[250px] truncate cursor-pointer"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {displayName}
        </div>
      </PopoverTrigger>
      <PopoverContent className="flex justify-center items-center w-auto max-w-[500px]">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {displayName}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Create a function that returns the columns with the onDelete prop and permissions
export const createColumns = (onDelete?: () => void, canDelete?: boolean): ColumnDef<TestRun>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="ml-2" column={column} title ="Run ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      
      return (
        <div className="w-[90px]">
          <UUIDField
            value={id} 
            maxLength={24} 
            onCopy={() => toast.success("Run ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "jobId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Job ID" />
    ),
    cell: ({ row }) => {
      const jobId = row.getValue("jobId") as string;

      return (
        <div className="w-[90px]">
          <UUIDField
            value={jobId}
            maxLength={24}
            className="w-[90px]"
            onCopy={() => toast.success("Job ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "jobName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Job Name" />
    ),
    cell: ({ row }) => {
      const jobName = row.getValue("jobName") as string | undefined;
      
      return (

          <JobNameWithPopover jobName={jobName} />

      );
    },
  },
  {
    accessorKey: "trigger",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Trigger" />
    ),
    cell: ({ row }) => {
      const trigger = row.original.trigger;
      const triggerType = triggerTypes.find((t) => t.value === trigger);

      if (!triggerType) {
        return <div className="text-muted-foreground">-</div>;
      }

      const { icon: Icon, label, color } = triggerType;

      return (
        <div className="flex items-center gap-2 w-[100px]">
          <Icon className={cn("w-4 h-4", color)} />
          <span>{label}</span>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
    enableSorting: true,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      
      // Map the status to a valid status for display
      const mappedStatus = mapDbStatusToDisplayStatus(status);
      const statusInfo = runStatuses.find(s => s.value === mappedStatus);
      
      return (
        <div className="flex items-center w-[100px]">
          {statusInfo ? (
            <div className="flex items-center">
              {statusInfo.icon && (
                <statusInfo.icon className={`h-4 w-4 mr-2 ${statusInfo.color}`} />
              )}
              <span>{statusInfo.label}</span>
            </div>
          ) : (
            <JobStatus jobId={row.getValue("jobId")} initialStatus={mappedStatus} />
          )}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },

  {
    accessorKey: "duration",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Duration" />
    ),
    cell: ({ row }) => {
      const duration = row.getValue("duration") as string | number | undefined;
      
      if (!duration) {
        return (
          <div className="flex items-center gap-1 w-[100px]">
            <ClockIcon className="h-4 w-4 text-muted-foreground mr-1" />
            <span className="text-muted-foreground">-</span>
          </div>
        );
      }
      
      // Format the duration when it's a number (seconds)
      let formattedDuration = duration;
      
      if (typeof duration === 'string') {
        // Check if the string contains only a number (legacy format)
        const numericDuration = parseInt(duration, 10);
        if (!isNaN(numericDuration)) {
          const seconds = numericDuration;
          const minutes = Math.floor(seconds / 60);
          const remainingSeconds = seconds % 60;
          
          formattedDuration = minutes > 0 
            ? `${minutes}m ${remainingSeconds}s` 
            : `${remainingSeconds}s`;
        }
        // If the duration is already formatted (like "3s" or "2m 5s"), use it as is
      } else if (typeof duration === 'number') {
        // Convert seconds to a readable format (not milliseconds)
        const seconds = duration;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        formattedDuration = minutes > 0 
          ? `${minutes}m ${remainingSeconds}s` 
          : `${remainingSeconds}s`;
      }
      
      return (
        <div className="flex items-center gap-1 w-[100px]">
          <ClockIcon className="h-4 w-4 text-muted-foreground mr-1" />
          <span>{formattedDuration}</span>
        </div>
      );
    },
  },
 
  {
    accessorKey: "startedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Started" />
    ),
    cell: ({ row }) => {
      const startedAt = row.getValue("startedAt") as string | undefined;
      if (!startedAt) {
        return <div className="text-muted-foreground">-</div>;
      }
      return (
        <div className="flex items-center gap-1 w-[150px]">
          <CalendarIcon className="h-4 w-4 text-muted-foreground mr-1" />
          <span title={new Date(startedAt).toLocaleString()}>
            {formatDistanceToNow(new Date(startedAt), { addSuffix: true })}
          </span>
        </div>
      );
    },
  },
  
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} onDelete={onDelete} canDelete={canDelete} />,
  },
];

// Export a default set of columns for backward compatibility
export const columns = createColumns();

// Helper to validate status is one of the allowed values
function mapDbStatusToDisplayStatus(dbStatus: string): string {
  // Convert the dbStatus to lowercase for case-insensitive comparison
  const status = typeof dbStatus === 'string' ? dbStatus.toLowerCase() : '';
  
  // Only return one of the allowed status values
  switch (status) {
    case 'running':
      return 'running';
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'error':
      return 'error';
    default:
      console.warn(`Unknown status: ${dbStatus}, defaulting to running`);
      return 'running';
  }
}
