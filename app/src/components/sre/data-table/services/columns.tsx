import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { type SreServiceListItem } from "@/actions/sre-services";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { isSafeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";
import { Archive, ExternalLink, Eye, MoreHorizontal, Pencil } from "lucide-react";
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

const statusTones: Record<SreServiceListItem["status"], TableBadgeTone> = {
  active: "success",
  deprecated: "warning",
  merged: "slate",
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
    cell: ({ row }) => <span className="whitespace-nowrap font-medium">{row.original.name}</span>,
  },
  {
    id: "environment",
    header: "Env",
    cell: ({ row }) => row.original.environment ? <TableBadge tone="info" compact className="whitespace-nowrap">{row.original.environment}</TableBadge> : <span>-</span>,
  },
  {
    id: "description",
    header: "Description",
    cell: ({ row }) => (
      <div
        className="max-w-[240px] truncate text-sm"
        title={row.original.description || ""}
      >
        {row.original.description || "-"}
      </div>
    ),
  },
  {
    accessorKey: "tier",
    header: "Tier",
    cell: ({ row }) => {
      const tier = row.getValue("tier") as SreServiceListItem["tier"];
      return <TableBadge compact>{tierLabels[tier]}</TableBadge>;
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
      return repo && isSafeEvidenceSourceUri(repo) ? (
        <a href={repo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap">
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
        <TableBadge tone={statusTones[service.status]} compact className="capitalize">
          {service.status}
        </TableBadge>
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
      return <span suppressHydrationWarning>{formatDate(row.getValue("updatedAt"))}</span>;
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/services/${service.id}`}>
                <Eye className="mr-2 h-4 w-4" />
                View details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => meta?.onEdit?.(service)}
            >
              <Pencil className="mr-2 h-4 w-4" />
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
