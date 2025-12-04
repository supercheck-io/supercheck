"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  Copy,
  Check,
  Activity,
  User,
  Calendar,
  Hash,
  Globe,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UUIDField } from "@/components/ui/uuid-field";

export interface AuditUser {
  id: string | null;
  name: string | null;
  email: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: AuditUser;
}

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
    <pre className="text-sm font-mono whitespace-pre overflow-x-auto">
      {formatValue(data)}
    </pre>
  );
}

const getActionBadgeColor = (action: string) => {
  if (action.includes("delete") || action.includes("remove"))
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (action.includes("create") || action.includes("add"))
    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (action.includes("update") || action.includes("edit"))
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  if (action.includes("login") || action.includes("auth"))
    return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
};

const formatDate = (dateString: string) => {
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

export const auditLogColumns: ColumnDef<AuditLog>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="ml-2" column={column} title="Log ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="w-[90px]">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("Log ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Timestamp" />
    ),
    cell: ({ row }) => {
      const { formattedDate, formattedTime } = formatDate(
        row.getValue("createdAt")
      );
      const date = new Date(row.getValue("createdAt"));
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();

      let timeAgo = "";
      if (diffMs < 60000) {
        timeAgo = "just now";
      } else if (diffMs < 3600000) {
        const minutes = Math.floor(diffMs / 60000);
        timeAgo = `${minutes}m ago`;
      } else if (diffMs < 86400000) {
        const hours = Math.floor(diffMs / 3600000);
        timeAgo = `${hours}h ago`;
      } else {
        const days = Math.floor(diffMs / 86400000);
        timeAgo = `${days}d ago`;
      }

      return (
        <div className="py-1 min-w-[140px] flex items-center h-12">
          <div>
            <div className="text-sm font-medium text-foreground">
              <span>{formattedDate}</span>
              <span className="text-muted-foreground ml-1 text-xs">
                {formattedTime}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-medium">
              {timeAgo}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Action" />
    ),
    cell: ({ row }) => {
      const action = row.getValue("action") as string;

      return (
        <div className="py-1 flex items-center h-12">
          <Badge
            variant="outline"
            className={`${getActionBadgeColor(action)} text-xs px-3 py-1.5 font-medium border-0`}
          >
            <Activity className="mr-1.5 h-3 w-3" />
            {action}
          </Badge>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    id: "user",
    accessorFn: (row) => {
      const user = row.user as AuditUser;
      return user.name || "System";
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => {
      const user = row.original.user as AuditUser;

      return (
        <div className="py-1 min-w-[160px] flex items-center h-12">
          <div className="flex items-center gap-2.5">
            <div className="flex-shrink-0">
              <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {user.name || "System"}
              </div>
              {user.email && (
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {user.email}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      if (!value || value.length === 0) return true;
      const userName = row.getValue(id) as string;
      return value.includes(userName);
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <ActionsCell log={row.original} />,
  },
];

// Separate component to use React hooks properly
function ActionsCell({ log }: { log: AuditLog }) {
  const { formattedDate, formattedTime } = formatDate(log.createdAt);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log.details, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  // Extract key info from details
  const details = log.details || {};
  const success = details.success as boolean | undefined;
  const resource = details.resource as string | undefined;
  const ipAddress = details.ipAddress as string | undefined;

  return (
    <div className="py-1 flex items-center h-12">
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-muted transition-colors"
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent className="min-w-[1000px] ">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  Audit Log Details
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Event recorded on {formattedDate} at {formattedTime}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Separator />

          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-5 py-4 pr-4">
              {/* Key Information Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Action */}
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Action
                  </p>
                  <Badge
                    variant="outline"
                    className={`${getActionBadgeColor(log.action)} text-xs px-2.5 py-1 font-medium border-0`}
                  >
                    <Activity className="mr-1 h-3 w-3" />
                    {log.action}
                  </Badge>
                </div>

                {/* User */}
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    User
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 text-sm font-medium truncate">
                      {log.user.name || "System"}
                    </div>
                  </div>
                </div>

                {/* Timestamp */}
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Timestamp
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{formattedDate}</span>
                    <span className="text-xs text-muted-foreground">
                      {formattedTime}
                    </span>
                  </div>
                </div>

                {/* Status */}
                <div className="p-3 rounded-lg border bg-card">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Status
                  </p>
                  {success !== undefined ? (
                    <div className="flex items-center gap-1.5">
                      {success ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">
                            Success
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-red-500" />
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">
                            Failed
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              {/* Additional Context Row */}
              {(resource || ipAddress || log.user.email) && (
                <div className="grid grid-cols-3 gap-4">
                  {resource && (
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Resource
                      </p>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {resource}
                      </Badge>
                    </div>
                  )}
                  {ipAddress && (
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        IP Address
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-mono">{ipAddress}</span>
                      </div>
                    </div>
                  )}
                  {log.user.email && (
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        User Email
                      </p>
                      <span className="text-sm">{log.user.email}</span>
                    </div>
                  )}
                </div>
              )}

              {/* JSON Details */}
              {log.details && Object.keys(log.details).length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold">Event Details</h3>
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border">
                          <Hash className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-mono text-muted-foreground">
                            {log.id}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyToClipboard}
                        className="h-7 gap-1.5 text-xs"
                      >
                        {copied ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copied ? "Copied!" : "Copy JSON"}
                      </Button>
                    </div>
                    <div className="p-4 bg-muted/50 dark:bg-muted/20 rounded-lg border overflow-hidden">
                      <SyntaxHighlightedJSON data={log.details} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
