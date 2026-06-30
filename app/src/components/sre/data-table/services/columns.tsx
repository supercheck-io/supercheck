import { ColumnDef } from "@tanstack/react-table";
import { type SreServiceListItem } from "@/actions/sre-services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, MoreHorizontal, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const tierLabels: Record<SreServiceListItem["tier"], string> = {
  "1": "Tier 1",
  "2": "Tier 2",
  "3": "Tier 3",
  "4": "Tier 4",
};

const statusClasses: Record<SreServiceListItem["status"], string> = {
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  deprecated:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  merged:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export const columns: ColumnDef<SreServiceListItem>[] = [
  {
    accessorKey: "name",
    header: "Service",
    cell: ({ row }) => <span className="font-medium whitespace-nowrap">{row.original.name}</span>,
  },
  {
    id: "environment",
    header: "Env",
    cell: ({ row }) => row.original.environment ? <Badge variant="secondary" className="whitespace-nowrap">{row.original.environment}</Badge> : <span>-</span>,
  },
  {
    id: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.original.description || ""}>
        {row.original.description || "-"}
      </div>
    ),
  },
  {
    accessorKey: "tier",
    header: "Tier",
    cell: ({ row }) => {
      const tier = row.getValue("tier") as SreServiceListItem["tier"];
      return <Badge variant="outline">{tierLabels[tier]}</Badge>;
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "ownerTeam",
    header: "Owner",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ownerTeam ?? "Unassigned"}</span>,
  },
  {
    id: "repo",
    header: "Repo",
    cell: ({ row }) => {
      const repo = row.original.repoUrl;
      return repo ? (
        <a href={repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap">
          Link <ExternalLink className="h-3 w-3" />
        </a>
      ) : <span>-</span>;
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const service = row.original;
      return (
        <Badge
          variant="outline"
          className={cn("capitalize", statusClasses[service.status])}
        >
          {service.status}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => {
      return formatDate(row.getValue("updatedAt"));
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const service = row.original;
      const meta = table.options.meta as {
        onEdit: (service: SreServiceListItem) => void;
        onDelete: (service: SreServiceListItem) => void;
      };

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open actions for ${service.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => meta?.onEdit?.(service)}
            >
              Edit service
            </DropdownMenuItem>
            {service.status !== "deprecated" && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => meta?.onDelete?.(service)}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive service
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
