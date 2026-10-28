import type { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import type { Monitor } from "./schema";
import { ClockIcon } from "lucide-react";
import { DateCell } from "@/components/ui/table-cells";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";

import { MonitorStatusIndicator } from "./monitor-status-indicator";
import { monitorTypes } from "./data";
import { formatDurationMinutes } from "@/lib/date-utils";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

export const statusPageColumns: ColumnDef<Monitor>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader
        className="ml-2"
        column={column}
        title="Monitor ID"
      />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="w-[90px]">
          <UUIDField
            value={id}
            maxLength={8}
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
      const type = monitorTypes.find(
        (type) => type.value === row.getValue("type")
      );

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
      const statusValue = row.getValue("status") as
        | "up"
        | "down"
        | "paused"
        | "pending"
        | "maintenance";
      return (
        <MonitorStatusIndicator
          status={statusValue}
          monitorId={row.original.id}
        />
      );
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
    cell: ({ row }) => <DateCell value={row.getValue("createdAt") as Date | string | null} empty="—" />,
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated" />
    ),
    cell: ({ row }) => {
      const updatedAt = row.getValue("updatedAt") as Date | string | null;
      // A fresh row has updatedAt equal to createdAt, which is not an edit.
      return <DateCell value={updatedAt !== row.getValue("createdAt") ? updatedAt : null} empty="Not updated" />;
    },
  },
];
