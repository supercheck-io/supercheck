import type { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import type { Monitor } from "./schema";
import { CalendarIcon, ClockIcon } from "lucide-react";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";


import { MonitorStatusIndicator } from "./monitor-status-indicator";
import { monitorTypes } from "./data";
import { formatDurationMinutes } from "@/lib/date-utils";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

// Type definition for the extended meta object used in this table
interface MonitorTableMeta {
  onDeleteMonitor?: (id: string) => void;
  globalFilterColumns?: string[];
  // Include other potential properties from the base TableMeta if needed
}

export const columns: ColumnDef<Monitor>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="ml-2" column={column} title="Monitor ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;    
      return (
        <div className="w-[90px]">
                <UUIDField 
                  value={id} 
                  maxLength={24} 
                  onCopy={() => toast.success("Monitor ID copied to clipboard")}
                />
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const name = row.getValue("name") as string;
      
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
    },
  },
  {
    accessorKey: "target",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Target" />
    ),
    cell: ({ row }) => {
      const target = row.getValue("target") as string;
      const legacyUrl = row.original.url as string; // Fallback for legacy data
      
      
      const displayValue = target || legacyUrl || "—";
      
      return (
        <TruncatedTextWithTooltip 
          text={displayValue}
          className="font-mono text-sm block"
          maxWidth="170px"
          maxLength={30}
        />
      );
    },
  },
  {
    accessorKey: "type",
    id: "type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => {
      const type = monitorTypes.find((type) => type.value === row.getValue("type"));

      if (!type) {
        return null;
      }

      return (
        <div className="flex items-center w-[150px]">
          {type.icon && <type.icon className={`mr-2 h-5 w-5 ${type.color}`} />}
          <span>{type.label}</span>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const statusValue = row.getValue("status") as "up" | "down" | "paused" | "pending" | "maintenance";
      return <MonitorStatusIndicator status={statusValue} monitorId={row.original.id} />;
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "frequencyMinutes",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Interval" />
    ),
    cell: ({ row }) => {
      const frequencyMinutes = row.getValue("frequencyMinutes") as number;
      
      // Format interval to be readable (i.e. 1 -> 1m, 60 -> 1h)
      const formatted = formatDurationMinutes(frequencyMinutes);

      return (
        <div className="flex items-center w-[80px]">
          <ClockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formatted}</span>
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
          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
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
            <ClockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
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
          <ClockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      // Explicitly cast table.options.meta to the extended type
      const meta = table.options.meta as MonitorTableMeta | undefined;
      const onDeleteCallback = meta?.onDeleteMonitor;

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