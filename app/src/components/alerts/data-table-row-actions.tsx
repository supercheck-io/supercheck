"use client";

import type { Row } from "@tanstack/react-table";
import { MoreHorizontal, ExternalLink, Copy } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { AlertHistory } from "./schema";

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const router = useRouter();
  const alert = row.original as unknown as AlertHistory;
  
  const handleViewTarget = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (alert.targetType === "monitor" && alert.targetId) {
      router.push(`/monitors/${alert.targetId}`);
    } else if (alert.targetType === "job" && alert.targetId) {
      router.push(`/jobs/?job=${alert.targetId}`);
    }
  };

  const handleCopyMessage = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(alert.message);
    toast.success("Alert message copied to clipboard");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]" onClick={(e) => e.stopPropagation()}>
        {alert.targetId && (
          <DropdownMenuItem onClick={handleViewTarget}>
            <ExternalLink className="mr-2 h-4 w-4" />
            <span>View {alert.targetType}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleCopyMessage}>
          <Copy className="mr-2 h-4 w-4" />
          <span>Copy Message</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
