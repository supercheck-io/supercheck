"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileSearch, MoreHorizontal } from "lucide-react";
import { type SreConnectorListItem } from "@/actions/sre-connectors";
import { cn } from "@/lib/utils";

const statusClasses: Record<SreConnectorListItem["status"], string> = {
  configured: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  valid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  unreachable: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  missing_credentials: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  disabled: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

function formatConnectorType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const evidenceSearchConnectorTypes = new Set([
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "sentry",
  "datadog",
  "loki",
  "elasticsearch",
  "tempo",
  "aws_cloudwatch",
]);

function supportsEvidenceSearch(connector: SreConnectorListItem) {
  return connector.status !== "disabled" && evidenceSearchConnectorTypes.has(connector.type);
}

export const columns: ColumnDef<SreConnectorListItem>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <span className="font-medium">{connector.name}</span>
      );
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => {
      const connector = row.original;
      return <Badge variant="outline">{formatConnectorType(connector.type)}</Badge>;
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <Badge variant="outline" className={cn("capitalize", statusClasses[connector.status])}>
          {connector.status.replace(/_/g, " ")}
        </Badge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const connector = row.original;
      const meta = table.options.meta as any;
      const { onSearch, onValidate, onViewJob, onRotate, onDisable } = meta || {};

      return (
        <div className="flex items-center justify-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Open actions for ${connector.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => meta?.onEdit?.(connector)}>
                Edit connector
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSearch?.(connector)} disabled={!supportsEvidenceSearch(connector)}>
                Search evidence
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onValidate?.(connector)} disabled={meta?.isValidating}>
                Validate connector
              </DropdownMenuItem>
              {connector.latestPrivateAgentJob && (
                <DropdownMenuItem onClick={() => onViewJob?.(connector)} disabled={meta?.isLoadingJobResult}>
                  View last job result
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onRotate?.(connector)} disabled={meta?.isDisabling || meta?.isValidating}>
                Rotate credential
              </DropdownMenuItem>
              {connector.status !== "disabled" && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDisable?.(connector)}
                >
                  Disable connector
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];
