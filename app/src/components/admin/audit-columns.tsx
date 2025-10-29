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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Copy, Check, Activity, User, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";

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

// JSON viewer component
function JsonViewer({ data, title }: { data: unknown; title: string }) {
  const [copied, setCopied] = useState(false);
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Failed to copy JSON");
    }
  };

  const formatJsonWithSyntaxHighlight = (obj: unknown): React.JSX.Element => {
    if (obj === null) return <span className="text-muted-foreground">null</span>;
    if (obj === undefined) return <span className="text-muted-foreground">undefined</span>;
    if (typeof obj === 'string') return <span className="text-green-600 dark:text-green-400">&quot;{obj}&quot;</span>;
    if (typeof obj === 'number') return <span className="text-blue-600 dark:text-blue-400">{obj}</span>;
    if (typeof obj === 'boolean') return <span className="text-purple-600 dark:text-purple-400">{obj.toString()}</span>;
    
    if (Array.isArray(obj)) {
      return (
        <div>
          <span className="text-muted-foreground">[</span>
          {obj.map((item, index) => (
            <div key={index} className="ml-4">
              {formatJsonWithSyntaxHighlight(item)}
              {index < obj.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
          <span className="text-muted-foreground">]</span>
        </div>
      );
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return (
        <div>
          <span className="text-muted-foreground">{'{'}</span>
          {Object.entries(obj as Record<string, unknown>).map(([key, value], index, array) => (
            <div key={key} className="ml-4">
              <span className="text-red-600 dark:text-red-400">&quot;{key}&quot;</span>
              <span className="text-muted-foreground">: </span>
              {formatJsonWithSyntaxHighlight(value)}
              {index < array.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
          <span className="text-muted-foreground">{'}'}</span>
        </div>
      );
    }
    
    return <span>{String(obj)}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{title}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={copyToClipboard}
          className="h-8"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      
      <Tabs defaultValue="formatted" className="w-full">
        <TabsList>
          <TabsTrigger value="formatted">Formatted</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>
        
        <TabsContent value="formatted" className="mt-4">
          <div className="p-4 bg-muted rounded-lg border font-mono text-sm overflow-auto max-h-96">
            {formatJsonWithSyntaxHighlight(data)}
          </div>
        </TabsContent>
        
        <TabsContent value="raw" className="mt-4">
          <pre className="p-4 bg-muted rounded-lg border text-sm overflow-auto max-h-96 whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const getActionBadgeColor = (action: string) => {
  if (action.includes('delete') || action.includes('remove')) return 'bg-red-200 text-red-800';
  if (action.includes('create') || action.includes('add')) return 'bg-green-200 text-green-800';
  if (action.includes('update') || action.includes('edit')) return 'bg-blue-200 text-blue-800';
  if (action.includes('login') || action.includes('auth')) return 'bg-purple-200 text-purple-800';
  return 'bg-gray-200 text-gray-800';
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
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Timestamp" />
    ),
    cell: ({ row }) => {
      const { formattedDate, formattedTime } = formatDate(row.getValue("createdAt"));
      const date = new Date(row.getValue("createdAt"));
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      
      let timeAgo = '';
      if (diffMs < 60000) {
        timeAgo = 'just now';
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
              <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
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
      return user.name || 'System';
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
                {user.name || 'System'}
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
    header: "Actions",
    cell: ({ row }) => {
      const log = row.original;
      
      return (
        <div className="py-1 flex items-center h-12">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-muted transition-colors">
                <Eye className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Audit Log Details
                </DialogTitle>
                <DialogDescription>
                  Detailed information about this audit log entry
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh]">
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Timestamp</label>
                      <div className="mt-1 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-mono">
                          {(() => {
                            const { formattedDate, formattedTime } = formatDate(log.createdAt);
                            return (
                              <>
                                <span>{formattedDate}</span>
                                <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
                              </>
                            );
                          })()}
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Action</label>
                      <div className="mt-1">
                        <Badge 
                          variant="outline" 
                          className={`${getActionBadgeColor(log.action)} text-xs px-2 py-1`}
                        >
                          <Activity className="mr-1 h-3 w-3" />
                          {log.action}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">User</label>
                      <div className="mt-1 flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{log.user.name || 'System'}</p>
                          {log.user.email && (
                            <p className="text-xs text-muted-foreground">{log.user.email}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Log ID</label>
                      <p className="text-xs font-mono mt-1 text-muted-foreground">{log.id}</p>
                    </div>
                  </div>
                  
                  {log.details && (
                    <div>
                      <JsonViewer data={log.details} title="Audit Details" />
                    </div>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      );
    },
  },
];