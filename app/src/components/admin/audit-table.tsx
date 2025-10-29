"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Search, Filter, Eye, Calendar, User, Activity, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface AuditUser {
  id: string | null;
  name: string | null;
  email: string | null;
}

interface AuditLog {
  id: string;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: Record<string, any> | null;
  createdAt: string;
  user: AuditUser;
}

interface AuditPagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface AuditData {
  logs: AuditLog[];
  pagination: AuditPagination;
  filters: {
    actions: string[];
  };
}

interface AuditTableProps {
  className?: string;
}

// JSON viewer component
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function JsonViewer({ data, title }: { data: any; title: string }) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatJsonWithSyntaxHighlight = (obj: any): React.JSX.Element => {
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
    
    if (typeof obj === 'object') {
      return (
        <div>
          <span className="text-muted-foreground">{'{'}</span>
          {Object.entries(obj).map(([key, value], index, array) => (
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

export default function AuditTable({ className }: AuditTableProps) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
        sortBy,
        sortOrder,
        ...(searchQuery && { search: searchQuery }),
        ...(actionFilter && actionFilter !== "all" && { action: actionFilter })
      });

      const response = await fetch(`/api/audit?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Audit API failed:', response.status, response.statusText, errorText);
        toast.error(`Failed to load audit logs: ${response.status} ${response.statusText}`);
        return;
      }

      const result = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        console.error('Audit API error:', result.error);
        toast.error(result.error || 'Failed to load audit logs');
      }
    } catch (_error) {
      console.error('Error fetching audit logs:', _error);
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [currentPage, sortBy, sortOrder, pageSize, actionFilter, searchQuery]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentPage === 1) {
        fetchAuditLogs();
      } else {
        setCurrentPage(1);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, currentPage, fetchAuditLogs]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="h-4 w-4" />;
    return sortOrder === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getActionBadgeVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    if (action.includes('delete') || action.includes('remove')) return "destructive";
    if (action.includes('create') || action.includes('add')) return "default";
    if (action.includes('update') || action.includes('edit')) return "secondary";
    return "outline";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDetailsPreview = (details: Record<string, any> | null) => {
    if (!details) return <span className="text-muted-foreground text-sm">No details</span>;
    
    const keys = Object.keys(details);
    if (keys.length === 0) return <span className="text-muted-foreground text-sm">No details</span>;
    
    const previewText = keys.slice(0, 2).map(key => `${key}: ${JSON.stringify(details[key])}`).join(', ');
    const truncated = previewText.length > 50 ? previewText.substring(0, 50) + '...' : previewText;
    
    return <span className="text-sm font-mono">{truncated}</span>;
  };

  if (loading && !data) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Audit Logs
          </CardTitle>
          <CardDescription>
            Track all administrative actions and system events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center items-center h-64">
            <div className="flex items-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading audit logs...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Audit Logs
        </CardTitle>
        <CardDescription>
          Track all administrative actions and system events
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search actions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {data?.filters.actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={pageSize.toString()} onValueChange={(value) => setPageSize(parseInt(value))}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            Showing {data?.logs.length || 0} of {data?.pagination.totalCount || 0} entries
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>Latest activity tracked</span>
          </div>
        </div>

        {/* Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort('createdAt')}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Timestamp
                    {getSortIcon('createdAt')}
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    className="h-auto p-0 hover:bg-transparent"
                    onClick={() => handleSort('action')}
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Action
                    {getSortIcon('action')}
                  </Button>
                </TableHead>
                <TableHead>
                  <div className="flex items-center">
                    <User className="h-4 w-4 mr-2" />
                    User
                  </div>
                </TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-sm">
                    {formatDate(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getActionBadgeVariant(log.action)}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{log.user.name || 'System'}</span>
                      {log.user.email && (
                        <span className="text-sm text-muted-foreground">{log.user.email}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {renderDetailsPreview(log.details)}
                  </TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-5xl max-h-[80vh]">
                        <DialogHeader>
                          <DialogTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            Audit Log Details
                          </DialogTitle>
                        </DialogHeader>
                        <ScrollArea className="max-h-[70vh]">
                          <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="text-sm font-medium text-muted-foreground">Timestamp</label>
                                <p className="text-sm font-mono mt-1">{formatDate(log.createdAt)}</p>
                              </div>
                              <div>
                                <label className="text-sm font-medium text-muted-foreground">Action</label>
                                <div className="mt-1">
                                  <Badge variant={getActionBadgeVariant(log.action)}>
                                    {log.action}
                                  </Badge>
                                </div>
                              </div>
                              <div>
                                <label className="text-sm font-medium text-muted-foreground">User</label>
                                <div className="mt-1">
                                  <p className="text-sm font-medium">{log.user.name || 'System'}</p>
                                  {log.user.email && (
                                    <p className="text-xs text-muted-foreground">{log.user.email}</p>
                                  )}
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
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.logs || data.logs.length === 0) && !loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Activity className="h-8 w-8" />
                      <p className="font-medium">No audit logs found</p>
                      <p className="text-sm">
                        {searchQuery || actionFilter !== "all" 
                          ? "Try adjusting your filters or search terms"
                          : "Audit logs will appear here as administrative actions are performed"
                        }
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {data.pagination.currentPage} of {data.pagination.totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data.pagination.hasPrev}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.pagination.hasNext}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}