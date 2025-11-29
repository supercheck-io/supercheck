"use client";

import { useState, useEffect } from "react";
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

interface ExecutionItem {
    runId: string;
    jobId: string | null;
    jobName: string;
    jobType: "playwright" | "k6";
    status: "running" | "queued";
    startedAt: Date | null;
    queuePosition?: number;
    source?: "job" | "playground";
}

interface ExecutionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultTab?: "running" | "queued";
}

const ITEMS_PER_PAGE = 5;

export function ExecutionsDialog({ open, onOpenChange, defaultTab = "running" }: ExecutionsDialogProps) {
    const [running, setRunning] = useState<ExecutionItem[]>([]);
    const [queued, setQueued] = useState<ExecutionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [runIdToCancel, setRunIdToCancel] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<string>(defaultTab);
    const [currentPage, setCurrentPage] = useState(1);

    // Update active tab when dialog opens or defaultTab changes
    useEffect(() => {
        if (open) {
            setActiveTab(defaultTab);
            setCurrentPage(1); // Reset to first page on open/tab change
        }
    }, [open, defaultTab]);

    // Reset page when tab changes manually
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);

    // Fetch initial data
    useEffect(() => {
        if (!open) return;

        async function fetchExecutions() {
            try {
                const res = await fetch("/api/executions/running");
                if (!res.ok) throw new Error("Failed to fetch executions");

                const data = await res.json();
                setRunning(
                    data.running.map((item: any) => ({
                        ...item,
                        startedAt: item.startedAt ? new Date(item.startedAt) : null,
                    }))
                );
                setQueued(data.queued);
            } catch (error) {
                console.error("Error fetching executions:", error);
                toast.error("Failed to load executions");
            } finally {
                setLoading(false);
            }
        }

        fetchExecutions();
    }, [open]);

    // SSE for real-time updates
    useEffect(() => {
        if (!open) return;

        const eventSource = new EventSource("/api/job-status/events");

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

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
                                    startedAt: new Date(),
                                    source: data.source, // Assuming SSE also sends source, or we default
                                },
                            ];
                        }
                        return prev;
                    });

                    // Remove from queued if it was there
                    setQueued((prev) => prev.filter((item) => item.runId !== data.runId));
                }

                // Remove completed/failed/cancelled jobs
                // Note: 'passed' is the status for successful completion from queue-event-hub
                // Also check for 'completed' event directly as a catch-all
                if (
                    ["completed", "passed", "failed", "cancelled", "error"].includes(data.status) ||
                    data.event === "completed"
                ) {
                    setRunning((prev) => prev.filter((item) => item.runId !== data.runId));
                    setQueued((prev) => prev.filter((item) => item.runId !== data.runId));
                }
            } catch (error) {
                console.error("Error processing SSE event:", error);
            }
        };

        eventSource.onerror = () => {
            console.error("SSE connection error");
            eventSource.close();
        };

        return () => {
            eventSource.close();
        };
    }, [open]);

    const handleCancelClick = (runId: string) => {
        setRunIdToCancel(runId);
    };

    const handleCancelConfirm = async () => {
        if (!runIdToCancel) return;

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
                    setRunning((prev) => prev.filter((item) => item.runId !== runIdToCancel));
                    setQueued((prev) => prev.filter((item) => item.runId !== runIdToCancel));
                } else {
                    throw new Error("Failed to cancel execution");
                }
            } else {
                toast.success("Execution cancelled successfully");
                // Remove from lists immediately
                setRunning((prev) => prev.filter((item) => item.runId !== runIdToCancel));
                setQueued((prev) => prev.filter((item) => item.runId !== runIdToCancel));
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

    const getTypeBadgeVariant = (type: "playwright" | "k6") => {
        return type === "playwright" ? "default" : "secondary";
    };

    const getSourceIcon = (source?: "job" | "playground") => {
        if (source === "playground") return <FlaskConical className="h-4 w-4 text-muted-foreground" />;
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
                        Jobs {activeTab === "running" ? "currently executing" : "waiting in queue"} will appear here
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
                                    <div className="flex items-center gap-2" title={getSourceLabel(item.source)}>
                                        {getSourceIcon(item.source)}
                                        <span className="text-xs text-muted-foreground hidden sm:inline">
                                            {getSourceLabel(item.source)}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center justify-center w-8" title={item.jobType.toUpperCase()}>
                                        {getTypeIcon(item.jobType)}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="font-medium text-sm truncate max-w-[200px]" title={item.jobName}>
                                        {item.jobName}
                                    </div>
                                    {item.queuePosition && (
                                        <Badge variant="secondary" className="text-[10px] mt-1">
                                            Position #{item.queuePosition}
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                    {item.startedAt ? (
                                        formatDistanceToNow(item.startedAt, { addSuffix: true })
                                    ) : (
                                        "Pending..."
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => handleCancelClick(item.runId)}
                                        disabled={cancellingId === item.runId}
                                        className="h-7 px-2 text-xs"
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
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                            <TabsList className="grid w-full grid-cols-2 mb-4">
                                <TabsTrigger value="running" className="flex items-center gap-2">
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
                                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
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
                                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
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
                            Are you sure you want to cancel this execution? This action cannot be undone and the run will be marked as cancelled.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Continue Running</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCancelConfirm} className="bg-destructive hover:bg-destructive/90">
                            Cancel Execution
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
