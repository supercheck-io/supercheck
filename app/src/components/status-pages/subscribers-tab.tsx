"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Mail,
  Trash2,
  RefreshCw,
  Search,
  Download,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Users,
  Slack,
  Webhook,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarIcon,
} from "lucide-react";
import { UUIDField } from "@/components/ui/uuid-field";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { format } from "date-fns";
import {
  getStatusPageSubscribers,
  deleteSubscriber,
  resendVerificationEmail,
} from "@/actions/get-status-page-subscribers";

type Subscriber = {
  id: string;
  email: string | null;
  endpoint: string | null;
  mode: string;
  verifiedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type SubscribersTabProps = {
  statusPageId: string;
};

export function SubscribersTab({ statusPageId }: SubscribersTabProps) {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, pending: 0 });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [subscriberToDelete, setSubscriberToDelete] = useState<string | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );

  const loadSubscribers = useCallback(async () => {
    setLoading(true);
    const result = await getStatusPageSubscribers(statusPageId);
    if (result.success) {
      setSubscribers(result.subscribers);
      setStats(result.stats);
    }
    setLoading(false);
  }, [statusPageId]);

  // Load subscribers on mount - deferred to avoid synchronous setState warning
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadSubscribers();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [loadSubscribers]);

  // Compute filtered subscribers based on search query - using useMemo instead of useEffect+setState
  const filteredSubscribers = React.useMemo(() => {
    if (searchQuery.trim() === "") {
      return subscribers;
    }
    const query = searchQuery.toLowerCase();
    return subscribers.filter(
      (s) =>
        s.email?.toLowerCase().includes(query) ||
        s.endpoint?.toLowerCase().includes(query)
    );
  }, [searchQuery, subscribers]);

  // Sorting function
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Sort subscribers
  const sortedSubscribers = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredSubscribers;

    return [...filteredSubscribers].sort((a, b) => {
      let aValue: string | Date | null = null;
      let bValue: string | Date | null = null;

      switch (sortColumn) {
        case "identifier":
          aValue = a.email || a.endpoint || "";
          bValue = b.email || b.endpoint || "";
          break;
        case "mode":
          aValue = a.mode;
          bValue = b.mode;
          break;
        case "status":
          aValue = a.verifiedAt ? "verified" : "pending";
          bValue = b.verifiedAt ? "verified" : "pending";
          break;
        case "createdAt":
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        default:
          return 0;
      }

      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return sortDirection === "asc" ? 1 : -1;
      if (bValue === null) return sortDirection === "asc" ? -1 : 1;

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredSubscribers, sortColumn, sortDirection]);

  const handleDelete = async () => {
    if (!subscriberToDelete) return;

    setActionLoading(subscriberToDelete);
    const result = await deleteSubscriber(subscriberToDelete);

    if (result.success) {
      toast.success("Subscriber removed successfully");
      await loadSubscribers();
    } else {
      toast.error("Failed to remove subscriber", {
        description: result.message,
      });
    }

    setActionLoading(null);
    setDeleteDialogOpen(false);
    setSubscriberToDelete(null);
  };

  const handleResendVerification = async (subscriberId: string) => {
    setActionLoading(subscriberId);
    const result = await resendVerificationEmail(subscriberId);

    if (result.success) {
      toast.success("Verification email sent");
    } else {
      toast.error("Failed to send verification email", {
        description: result.message,
      });
    }

    setActionLoading(null);
  };

  const handleExportCSV = () => {
    const csvContent = [
      ["Identifier", "Mode", "Status", "Subscribed Date"],
      ...subscribers.map((s) => [
        s.email || s.endpoint || "",
        s.mode,
        s.verifiedAt ? "Verified" : "Pending",
        s.createdAt ? format(new Date(s.createdAt), "yyyy-MM-dd HH:mm") : "",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Subscribers exported to CSV");
  };

  // Pagination calculations
  const totalPages = Math.ceil(sortedSubscribers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedSubscribers = sortedSubscribers.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Subscribers</CardTitle>
            </div>
            <CardDescription>
              Manage users who receive notifications about your status page
              updates
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or webhook URL..."
                value=""
                disabled
                className="pl-9 w-[300px]"
              />
            </div>
            <Button variant="outline" disabled size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-6">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">
                    Total Subscribers
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/50">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">Verified</div>
                </div>
              </div>
            </div>
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                  <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">
                    Pending Verification
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Table with loading spinner */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Subscriber ID</TableHead>
                  <TableHead>Identifier</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Subscribed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex justify-center items-center space-x-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Loading data...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Subscribers</CardTitle>
          </div>
          <CardDescription>
            Manage users who receive notifications about your status page
            updates
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email or webhook URL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[300px]"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={subscribers.length === 0}
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-muted-foreground">
                  Total Subscribers
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/50">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.verified}</div>
                <div className="text-sm text-muted-foreground">Verified</div>
              </div>
            </div>
          </div>
          <div className="p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.pending}</div>
                <div className="text-sm text-muted-foreground">
                  Pending Verification
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Subscribers Table */}
        {sortedSubscribers.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/20">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
              <Mail className="h-7 w-7 text-muted-foreground" />
            </div>
            <h4 className="text-base font-semibold mb-1">
              {searchQuery ? "No subscribers found" : "No subscribers yet"}
            </h4>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {searchQuery
                ? "Try a different search query"
                : "Subscribers will appear here once users sign up for notifications"}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Subscriber ID</TableHead>
                    <TableHead>
                      <button
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                          sortColumn === "identifier" &&
                            "bg-muted font-semibold"
                        )}
                        onClick={() => handleSort("identifier")}
                      >
                        Identifier
                        {sortColumn === "identifier" &&
                        sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "identifier" &&
                          sortDirection === "desc" ? (
                          <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                        ) : (
                          <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                          sortColumn === "mode" && "bg-muted font-semibold"
                        )}
                        onClick={() => handleSort("mode")}
                      >
                        Mode
                        {sortColumn === "mode" && sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "mode" &&
                          sortDirection === "desc" ? (
                          <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                        ) : (
                          <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                          sortColumn === "status" && "bg-muted font-semibold"
                        )}
                        onClick={() => handleSort("status")}
                      >
                        Status
                        {sortColumn === "status" && sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "status" &&
                          sortDirection === "desc" ? (
                          <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                        ) : (
                          <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                          sortColumn === "createdAt" && "bg-muted font-semibold"
                        )}
                        onClick={() => handleSort("createdAt")}
                      >
                        Subscribed
                        {sortColumn === "createdAt" &&
                        sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "createdAt" &&
                          sortDirection === "desc" ? (
                          <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                        ) : (
                          <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSubscribers.map((subscriber) => (
                    <TableRow key={subscriber.id}>
                      <TableCell>
                        <UUIDField
                          value={subscriber.id}
                          maxLength={8}
                          onCopy={() =>
                            toast.success("Subscriber ID copied to clipboard")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {subscriber.mode === "email" ? (
                          <TruncatedTextWithTooltip
                            text={subscriber.email || "-"}
                            className="font-medium"
                            maxWidth="200px"
                            maxLength={25}
                          />
                        ) : subscriber.mode === "slack" ||
                          subscriber.mode === "webhook" ? (
                          <TruncatedTextWithTooltip
                            text={subscriber.endpoint || "-"}
                            className="text-sm"
                            maxWidth="200px"
                            maxLength={30}
                          />
                        ) : (
                          <TruncatedTextWithTooltip
                            text={
                              subscriber.email || subscriber.endpoint || "-"
                            }
                            className="font-medium"
                            maxWidth="200px"
                            maxLength={25}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {subscriber.mode === "email" && (
                            <>
                              <Mail className="h-4 w-4 text-blue-500" />
                              <span className="capitalize">Email</span>
                            </>
                          )}
                          {subscriber.mode === "slack" && (
                            <>
                              <Slack className="h-4 w-4 text-sky-500" />
                              <span className="capitalize">Slack</span>
                            </>
                          )}
                          {subscriber.mode === "webhook" && (
                            <>
                              <Webhook className="h-4 w-4 text-green-500" />
                              <span className="capitalize">Webhook</span>
                            </>
                          )}
                          {!["email", "slack", "webhook"].includes(
                            subscriber.mode
                          ) && (
                            <span className="capitalize">
                              {subscriber.mode}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {subscriber.verifiedAt ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center w-[170px]">
                          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>
                            {subscriber.createdAt
                              ? format(
                                  new Date(subscriber.createdAt),
                                  "MMM d, yyyy"
                                )
                              : "-"}
                          </span>
                          {subscriber.createdAt && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              {format(new Date(subscriber.createdAt), "h:mm a")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {!subscriber.verifiedAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleResendVerification(subscriber.id)
                              }
                              disabled={actionLoading === subscriber.id}
                              className="h-8 w-8 p-0"
                              title="Resend verification"
                            >
                              {actionLoading === subscriber.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSubscriberToDelete(subscriber.id);
                              setDeleteDialogOpen(true);
                            }}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            title="Delete subscriber"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {sortedSubscribers.length > 0 && (
              <div className="flex items-center justify-between mt-4 px-2">
                <div className="flex-1 text-sm text-muted-foreground">
                  Total {sortedSubscribers.length} subscribers
                </div>
                <div className="flex items-center space-x-6 lg:space-x-8">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm">Rows per page</p>
                    <Select
                      value={`${itemsPerPage}`}
                      onValueChange={(value) => {
                        setItemsPerPage(Number(value));
                        setCurrentPage(1);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[70px]">
                        <span>{itemsPerPage}</span>
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[5, 10, 25, 50].map((pageSize) => (
                          <SelectItem key={pageSize} value={`${pageSize}`}>
                            {pageSize}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-[100px] items-center justify-center text-sm">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 w-8 p-0"
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 w-8 p-0"
                      onClick={() =>
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                      }
                      disabled={currentPage === totalPages}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Subscriber</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this subscriber? They will no
                longer receive notifications and their data will be permanently
                deleted in 30 days.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
