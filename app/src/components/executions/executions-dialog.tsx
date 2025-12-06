"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, FlaskConical, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";
import { useProjectContext } from "@/hooks/use-project-context";
import { canCancelRuns } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";

interface ExecutionItem {
  runId: string;
  jobId: string | null;
  jobName: string;
  jobType: "playwright" | "k6";
  status: "running" | "queued";
  startedAt: Date | null;
  queuePosition?: number;
  source?: "job" | "playground";
  projectName?: string;
}

interface ExecutionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "running" | "queued";
}

const ITEMS_PER_PAGE = 5;

export function ExecutionsDialog({
  open,
  onOpenChange,
  defaultTab = "running",
}: ExecutionsDialogProps) {
  const [running, setRunning] = useState<ExecutionItem[]>([]);
  const [queued, setQueued] = useState<ExecutionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [runIdToCancel, setRunIdToCancel] = useState<string | null>(null);
  const runIdToCancelRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [currentPage, setCurrentPage] = useState(1);

  // Get user permissions for cancel action
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCancel = canCancelRuns(normalizedRole);

  // SSE connection management refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // Debounce ref for sync events
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update active tab when dialog opens or defaultTab changes
  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setCurrentPage(1);
    }
  }, [open, defaultTab]);

  // Reset page when tab changes manually
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  // Keep ref in sync with state for SSE handler closure
  useEffect(() => {
    runIdToCancelRef.current = runIdToCancel;
  }, [runIdToCancel]);

  // Fetch executions data with error handling
  const fetchExecutions = useCallback(async (showLoadingToast = false) => {
    try {
      const res = await fetch("/api/executions/running", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch executions");

      const data = await res.json();
      setRunning(
        (data.running as ExecutionItem[]).map((item) => ({
          ...item,
          startedAt: item.startedAt ? new Date(item.startedAt) : null,
        }))
      );
      setQueued(
        (data.queued as ExecutionItem[]).map((item) => ({
          ...item,
          startedAt: item.startedAt ? new Date(item.startedAt) : null,
        }))
      );
    } catch (error) {
      console.error("Error fetching executions:", error);
      if (showLoadingToast) {
        toast.error("Failed to load executions");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Helper to debounce sync requests
  const triggerSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    // Debounce for 500ms to batch rapid updates
    syncTimeoutRef.current = setTimeout(() => {
      fetchExecutions();
    }, 500);
  }, [fetchExecutions]);

  // Set up SSE connection with reconnection logic
  const setupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Use organization-scoped SSE endpoint for cross-project visibility
      const source = new EventSource("/api/executions/events");
      eventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle sync request from server (triggered by Redis Pub/Sub)
          if (data.type === "sync") {
            triggerSync();
            return;
          }

          // Update running jobs
          if (data.status === "running" && data.runId) {
            setRunning((prev) => {
              const exists = prev.find((item) => item.runId === data.runId);
              if (!exists && data.jobName && data.jobType) {
                return [
                  ...prev,
                  {
                    runId: data.runId,
                    jobId: data.jobId,
                    jobName: data.jobName,
                    jobType: data.jobType as "playwright" | "k6",
                    status: "running",
                    startedAt: data.startedAt
                      ? new Date(data.startedAt)
                      : new Date(),
                    source: data.source,
                    projectName: data.projectName,
                  },
                ];
              }
              return prev;
            });

            // Remove from queued if it was there
            setQueued((prev) =>
              prev.filter((item) => item.runId !== data.runId)
            );
          }

          // Remove completed/failed/cancelled jobs
          if (
            ["completed", "passed", "failed", "cancelled", "error"].includes(
              data.status
            ) ||
            data.event === "completed"
          ) {
            setRunning((prev) =>
              prev.filter((item) => item.runId !== data.runId)
            );
            setQueued((prev) =>
              prev.filter((item) => item.runId !== data.runId)
            );

            // Close confirmation dialog if this run was being cancelled
            if (data.runId === runIdToCancelRef.current) {
              setRunIdToCancel(null);
              setCancellingId(null);
              toast.info(
                "Execution completed before cancellation could be processed"
              );
            }
            
            // Also trigger a sync to ensure lists are consistent
            triggerSync();
          }
        } catch (error) {
          console.error("Error processing SSE event:", error);
        }
      };

      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;

        // Exponential backoff for reconnection
        const backoffTime = Math.min(
          1000 * Math.pow(1.5, reconnectAttemptsRef.current),
          10000
        );
        reconnectAttemptsRef.current++;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (document.visibilityState !== "hidden") {
            setupEventSource();
          }
        }, backoffTime);
      };

      return source;
    } catch (err) {
      console.error("Failed to initialize SSE:", err);
      return null;
    }
  }, [triggerSync]);

  // Fetch initial data when dialog opens
  useEffect(() => {
    if (!open) {
      setLoading(true);
      return;
    }

    // Fetch immediately when dialog opens, show toast on error
    fetchExecutions(true);
  }, [open, fetchExecutions]);

  // SSE connection management
  useEffect(() => {
    if (!open) {
      // Cleanup when dialog closes
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      return;
    }

    // Handle visibility changes to reconnect when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && open) {
        // Re-fetch data when tab becomes visible
        fetchExecutions();
        // Reconnect SSE if not connected
        if (!eventSourceRef.current) {
          setupEventSource();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial SSE setup
    const source = setupEventSource();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }

      if (source) {
        source.close();
      }
      eventSourceRef.current = null;
    };
  }, [open, setupEventSource, fetchExecutions]);

  const handleCancelClick = (runId: string) => {
    setRunIdToCancel(runId);
  };

  const handleCancelConfirm = async () => {
    if (!runIdToCancel) return;

    // Pre-check: verify run still exists in running/queued lists
    // This handles the case where SSE updated faster than React state
    const stillExists =
      running.some((item) => item.runId === runIdToCancel) ||
      queued.some((item) => item.runId === runIdToCancel);
    if (!stillExists) {
      toast.info("Execution already completed");
      setRunIdToCancel(null);
      return;
    }

    setCancellingId(runIdToCancel);
    try {
      const res = await fetch(`/api/runs/${runIdToCancel}/cancel`, {
        method: "POST",
      });

      if (!res.ok) {
        // If the error is 400, it likely means the run is already in a terminal state (passed/failed)
        // In this case, we should remove it from the list to update the UI
        if (res.status === 400) {
          toast.info("Execution already completed");
          setRunning((prev) =>
            prev.filter((item) => item.runId !== runIdToCancel)
          );
          setQueued((prev) =>
            prev.filter((item) => item.runId !== runIdToCancel)
          );
        } else {
          throw new Error("Failed to cancel execution");
        }
      } else {
        toast.success("Execution cancelled successfully");
        // Remove from lists immediately
        setRunning((prev) =>
          prev.filter((item) => item.runId !== runIdToCancel)
        );
        setQueued((prev) =>
          prev.filter((item) => item.runId !== runIdToCancel)
        );
      }
    } catch (error) {
      console.error("Error cancelling execution:", error);
      toast.error("Failed to cancel execution");
    } finally {
      setCancellingId(null);
      setRunIdToCancel(null);
    }
  };

  const getTypeIcon = (type: "playwright" | "k6") => {
    return type === "playwright" ? (
      <PlaywrightLogo width={20} height={20} />
    ) : (
      <K6Logo width={20} height={20} />
    );
  };

  const getSourceIcon = (source?: "job" | "playground") => {
    if (source === "playground")
      return <FlaskConical className="h-4 w-4 text-muted-foreground" />;
    return <CalendarClock className="h-4 w-4 text-muted-foreground" />;
  };

  const getSourceLabel = (source?: "job" | "playground") => {
    if (source === "playground") return "Playground";
    return "Job";
  };

  // Pagination Logic
  const currentData = activeTab === "running" ? running : queued;
  const totalPages = Math.ceil(currentData.length / ITEMS_PER_PAGE);
  const paginatedData = currentData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const ExecutionsTable = ({ data }: { data: ExecutionItem[] }) => {
    if (data.length === 0) {
      return (
        <div className="text-center py-12 border rounded-lg bg-muted/10">
          <div className="text-muted-foreground mb-2">
            No {activeTab} executions
          </div>
          <p className="text-xs text-muted-foreground/60">
            Jobs{" "}
            {activeTab === "running"
              ? "currently executing"
              : "waiting in queue"}{" "}
            will appear here
          </p>
        </div>
      );
    }

    return (
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Source</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-[150px]">Project</TableHead>
              <TableHead className="w-[150px]">
                {activeTab === "running" ? "Started" : "Queued"}
              </TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.runId}>
                <TableCell>
                  <div
                    className="flex items-center gap-2"
                    title={getSourceLabel(item.source)}
                  >
                    {getSourceIcon(item.source)}
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {getSourceLabel(item.source)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className="flex items-center justify-center w-8"
                    title={item.jobType.toUpperCase()}
                  >
                    {getTypeIcon(item.jobType)}
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className="font-medium text-sm truncate max-w-[200px]"
                    title={item.jobName}
                  >
                    {item.jobName}
                  </div>
                  {item.queuePosition && (
                    <Badge variant="secondary" className="text-[10px] mt-1">
                      Position #{item.queuePosition}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div
                    className="text-sm truncate max-w-[150px]"
                    title={item.projectName || "—"}
                  >
                    {item.projectName || "—"}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.startedAt
                    ? formatDistanceToNow(item.startedAt, { addSuffix: true })
                    : "Pending..."}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleCancelClick(item.runId)}
                    disabled={!canCancel || cancellingId === item.runId}
                    className="h-7 px-2 text-xs"
                    title={
                      !canCancel
                        ? "Insufficient permissions to cancel executions"
                        : undefined
                    }
                  >
                    {cancellingId === item.runId ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Cancel
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Parallel Executions</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger
                  value="running"
                  className="flex items-center gap-2"
                >
                  Running
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {running.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="queued" className="flex items-center gap-2">
                  Queued
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {queued.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="running" className="space-y-4">
                <ExecutionsTable data={paginatedData} />
              </TabsContent>

              <TabsContent value="queued" className="space-y-4">
                <ExecutionsTable data={paginatedData} />
              </TabsContent>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() =>
                            setCurrentPage((p) => Math.max(1, p - 1))
                          }
                          className={
                            currentPage === 1
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>

                      {Array.from({ length: totalPages }).map((_, i) => (
                        <PaginationItem key={i}>
                          <PaginationLink
                            isActive={currentPage === i + 1}
                            onClick={() => setCurrentPage(i + 1)}
                            className="cursor-pointer"
                          >
                            {i + 1}
                          </PaginationLink>
                        </PaginationItem>
                      ))}

                      <PaginationItem>
                        <PaginationNext
                          onClick={() =>
                            setCurrentPage((p) => Math.min(totalPages, p + 1))
                          }
                          className={
                            currentPage === totalPages
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog
        open={runIdToCancel !== null}
        onOpenChange={(open) => !open && setRunIdToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Execution?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this execution? This action cannot
              be undone and the run will be marked as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
              Continue Running
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.stopPropagation();
                handleCancelConfirm();
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Cancel Execution
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
