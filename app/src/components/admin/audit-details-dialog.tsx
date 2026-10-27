"use client";

import { useState } from "react";
import { Activity, Check, ChevronRight, Copy, Eye } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UUIDField } from "@/components/ui/uuid-field";
import { formatAuditAction } from "./audit-action-labels";
import type { AuditLog } from "./audit-columns";

// Format JSON with syntax highlighting
function SyntaxHighlightedJSON({ data }: { data: unknown }) {
  const formatValue = (value: unknown, indent: number = 0): React.ReactNode => {
    const indentStr = "  ".repeat(indent);
    const nextIndentStr = "  ".repeat(indent + 1);

    if (value === null) return <span className="text-orange-500">null</span>;
    if (value === undefined)
      return <span className="text-gray-400">undefined</span>;
    if (typeof value === "boolean")
      return <span className="text-purple-500">{value.toString()}</span>;
    if (typeof value === "number")
      return <span className="text-blue-500">{value}</span>;
    if (typeof value === "string")
      return (
        <span className="text-green-600 dark:text-green-400">
          &quot;{value}&quot;
        </span>
      );

    if (Array.isArray(value)) {
      if (value.length === 0)
        return <span className="text-muted-foreground">[]</span>;
      return (
        <span>
          <span className="text-muted-foreground">[</span>
          {value.map((item, i) => (
            <span key={i}>
              {"\n"}
              {nextIndentStr}
              {formatValue(item, indent + 1)}
              {i < value.length - 1 && (
                <span className="text-muted-foreground">,</span>
              )}
            </span>
          ))}
          {"\n"}
          {indentStr}
          <span className="text-muted-foreground">]</span>
        </span>
      );
    }

    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0)
        return <span className="text-muted-foreground">{"{}"}</span>;
      return (
        <span>
          <span className="text-muted-foreground">{"{"}</span>
          {entries.map(([key, val], i) => (
            <span key={key}>
              {"\n"}
              {nextIndentStr}
              <span className="text-rose-500 dark:text-rose-400">
                &quot;{key}&quot;
              </span>
              <span className="text-muted-foreground">: </span>
              {formatValue(val, indent + 1)}
              {i < entries.length - 1 && (
                <span className="text-muted-foreground">,</span>
              )}
            </span>
          ))}
          {"\n"}
          {indentStr}
          <span className="text-muted-foreground">{"}"}</span>
        </span>
      );
    }

    return <span>{String(value)}</span>;
  };

  return (
    <pre className="text-sm font-mono whitespace-pre-wrap break-all">
      {formatValue(data)}
    </pre>
  );
}


export const getActionBadgeTone = (action: string): TableBadgeTone => {
  if (action.includes("delete") || action.includes("remove"))
    return "danger";
  if (action.includes("create") || action.includes("add"))
    return "success";
  if (action.includes("update") || action.includes("edit"))
    return "info";
  if (action.includes("login") || action.includes("auth"))
    return "purple";
  return "slate";
};

export const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { formattedDate, formattedTime };
};


function str(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

/** Eye button that opens a compact, read-only view of one audit log entry. */
export function AuditDetailsDialog({ log }: { log: AuditLog }) {
  const [copied, setCopied] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const { formattedDate, formattedTime } = formatDate(log.createdAt);
  const details = log.details ?? {};
  const hasDetails = Object.keys(details).length > 0;
  const success = typeof details.success === "boolean" ? details.success : undefined;
  const resource = str(details.resource);
  const resourceId = str(details.resourceId);
  const ipAddress = str(details.ipAddress);
  const userAgent = str(details.userAgent);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log.details, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`View details for ${formatAuditAction(log.action)}`}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">View details</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-2xl gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="text-lg">
              {formatAuditAction(log.action)}
            </DialogTitle>
            <TableBadge tone={getActionBadgeTone(log.action)} compact>
              <Activity className="mr-1 h-3 w-3" />
              {log.action}
            </TableBadge>
            {success !== undefined && (
              <TableBadge tone={success ? "success" : "danger"} compact>
                {success ? "Success" : "Failed"}
              </TableBadge>
            )}
          </div>
          <DialogDescription>
            Recorded on {formattedDate} at {formattedTime}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <Field label="User">{log.user.name || "System"}</Field>
          <Field label="Email">{log.user.email || "—"}</Field>
          <Field label="Resource">
            {resource ? (
              <span className="font-mono text-xs">
                {resource}
                {resourceId ? ` · ${resourceId}` : ""}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="IP address">
            {ipAddress ? <span className="font-mono text-xs">{ipAddress}</span> : "—"}
          </Field>
          <Field label="User agent">
            {userAgent ? (
              <span title={userAgent} className="block truncate text-xs">
                {userAgent}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Log ID">
            <UUIDField
              value={log.id}
              maxLength={8}
              onCopy={() => toast.success("Log ID copied to clipboard")}
            />
          </Field>
        </dl>

        {hasDetails && (
          <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2 gap-1.5">
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${jsonOpen ? "rotate-90" : ""}`}
                  />
                  Event details
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="outline"
                size="sm"
                onClick={copyJson}
                className="h-7 gap-1.5 text-xs"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied!" : "Copy JSON"}
              </Button>
            </div>
            <CollapsibleContent>
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border bg-muted/50 p-3 dark:bg-muted/20">
                <SyntaxHighlightedJSON data={log.details} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </DialogContent>
    </Dialog>
  );
}
