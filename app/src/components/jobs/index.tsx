"use client";

import React, { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { jobStatuses } from "./data";
import { Job, Test } from "./schema";
import { CalendarIcon, ClockIcon, TimerIcon, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useJobContext } from "./job-context";
import { formatDistanceToNow } from "date-fns";
import { UUIDField } from "@/components/ui/uuid-field";
import { Bell, BellOff, CheckCircle, XCircle, Clock, Copy } from "lucide-react";
import { UrlTriggerTooltip } from "./url-trigger-tooltip";
import { JobTestDataTable } from "./job-test-data-table";
import { createJobTestColumns } from "./job-test-columns";
import { useProjectContext } from "@/hooks/use-project-context";
import { canEditJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { useJobs, useJobMutations } from "@/hooks/use-jobs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Helper function to map incoming types to the valid Test["type"]
function mapToTestType(type: string | undefined): Test["type"] {
  switch (type) {
    case "browser":
    case "api":
    case "custom":
    case "database":
    case "performance":
      return type; // Already valid
    default:
      return "browser"; // Default to api
  }
}

export default function Jobs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedJobOverride, setSelectedJobOverride] = useState<Job | null>(null);
  const [isEditTestDialogOpen, setIsEditTestDialogOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const { } = useJobContext();
  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );
  const { currentProject } = useProjectContext();

  // Use React Query hook for jobs data (cached, handles loading/error)
  const { jobs: rawJobs, isLoading, invalidate } = useJobs();

  // Check permissions
  const userRole = currentProject?.userRole ? normalizeRole(currentProject.userRole) : null;
  const hasEditPermission = userRole ? canEditJobs(userRole) : false;


  const safeSetSelectedTest = useCallback((test: Test | null) => {
    if (isMounted) {
      setSelectedTest(test);
    }
  }, [isMounted]);

  // Handle job selection with URL update
  const handleJobSelect = (job: Job) => {
    // Update URL first, let useEffect handle the state
    const params = new URLSearchParams(searchParams);
    params.set('job', job.id);
    router.push(`/jobs?${params.toString()}`, { scroll: false });
  };

  // Handle job sheet close
  const handleJobSheetClose = () => {
    // Update URL first, let useEffect handle the state
    const params = new URLSearchParams(searchParams);
    params.delete('job');
    const newUrl = params.toString() ? `/jobs?${params.toString()}` : '/jobs';
    router.push(newUrl, { scroll: false });
  };

  // Transform jobs data with memoization to match local Job schema
  const jobs = useMemo<Job[]>(() => {
    if (!rawJobs || rawJobs.length === 0) return [];

    return rawJobs.map((job) => {
      // Map tests from API format to local Test schema
      const tests: Test[] = Array.isArray(job.tests)
        ? job.tests.map((test) => ({
          id: test.id,
          name: test.title || test.name || "",
          description: test.description || null,
          type: mapToTestType(test.type),
          status: undefined, // API doesn't return test status in job context
          lastRunAt: test.updatedAt || null,
          duration: null,
          tags: test.tags?.map(t => ({ ...t, color: t.color || null })),
        }))
        : [];

      // Map lastRun to match local schema
      const lastRun = job.lastRun ? {
        id: job.lastRun.id,
        status: job.lastRun.status,
        startedAt: job.lastRun.startedAt ?? null,
        completedAt: job.lastRun.completedAt ?? null,
        duration: null,
        errorDetails: job.lastRun.errorDetails ?? null,
      } : undefined;

      return {
        id: job.id,
        name: job.name,
        description: job.description || null,
        cronSchedule: job.cronSchedule || null,
        status: job.status as Job["status"],
        jobType: (job.jobType || "playwright") as Job["jobType"],
        lastRunAt: job.lastRunAt || null,
        nextRunAt: job.nextRunAt || null,
        createdAt: job.createdAt || undefined,
        updatedAt: job.updatedAt || undefined,
        tests,
        alertConfig: job.alertConfig as Job["alertConfig"],
        lastRun,
      };
    });
  }, [rawJobs]);

  // Derive selectedJob and isSheetOpen from URL params (no effect needed)
  const jobIdFromUrl = searchParams.get('job');
  const selectedJob = useMemo(() => {
    if (selectedJobOverride) return selectedJobOverride;
    if (!jobIdFromUrl || jobs.length === 0) return null;
    return jobs.find((j: Job) => j.id === jobIdFromUrl) || null;
  }, [jobIdFromUrl, jobs, selectedJobOverride]);
  const isSheetOpen = !!selectedJob;

  // Handle invalid job ID in URL (job not found)
  useEffect(() => {
    if (jobIdFromUrl && jobs.length > 0 && !jobs.find((j: Job) => j.id === jobIdFromUrl)) {
      // Job not found, remove from URL
      const params = new URLSearchParams(searchParams);
      params.delete('job');
      const newUrl = params.toString() ? `/jobs?${params.toString()}` : '/jobs';
      router.replace(newUrl, { scroll: false });
    }
  }, [jobIdFromUrl, jobs, searchParams, router]);

  // Edit an existing test
  const handleEditTest = () => {
    // Ensure selectedTest exists
    if (selectedJob && selectedTest) {
      const updatedTests =
        selectedJob.tests?.map((test) => {
          if (test.id === selectedTest.id) {
            // Use the helper function to ensure the type conforms
            const mappedType = mapToTestType(selectedTest.type);
            return { ...selectedTest, type: mappedType }; // Use the mapped type
          }
          return test;
        }) || [];

      const updatedJob = {
        ...selectedJob,
        tests: updatedTests,
      };

      // Update the selected job
      setSelectedJobOverride(updatedJob);

      // Reset the selected test
      setSelectedTest(null);

      // Close the dialog
      setIsEditTestDialogOpen(false);
    }
  };

  // Format date for display
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "No date";

    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Format relative date (e.g., "2 hours ago")
  const formatRelativeDate = (dateString: string | null | undefined) => {
    if (!dateString) return "No date";

    try {
      const date = new Date(dateString);

      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }

      // Use date-fns with explicit Date type
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      console.error("Error formatting relative date:", error);
      return "Invalid date";
    }
  };

  // Format date for update section (shows "Not updated" instead of "No date")
  const formatUpdateDate = (dateString: string | null | undefined) => {
    if (!dateString) return "Not updated";

    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Format relative date for update section (shows "Not updated" instead of "No date")
  const formatUpdateRelativeDate = (dateString: string | null | undefined) => {
    if (!dateString) return "Not updated";

    try {
      const date = new Date(dateString);

      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "Invalid date";
      }

      // Use date-fns with explicit Date type
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      console.error("Error formatting relative date:", error);
      return "Invalid date";
    }
  };

  // Check if dates match (for run date detection)
  const datesMatch = (
    date1: string | null | undefined,
    date2: string | null | undefined,
  ) => {
    if (!date1 || !date2) return false;

    try {
      const d1 = new Date(date1).getTime();
      const d2 = new Date(date2).getTime();

      // Consider dates close enough (within 5 seconds) as matching
      // This handles small timing differences in database updates
      return Math.abs(d1 - d2) < 5000;
    } catch {
      return false;
    }
  };

  const { deleteJob } = useJobMutations();

  const handleDeleteJob = async (jobId: string) => {
    try {
      await deleteJob.mutateAsync(jobId);
      toast.success("Job deleted successfully");

      // If the deleted job is currently selected, close the sheet by updating URL
      if (selectedJob && selectedJob.id === jobId) {
        handleJobSheetClose();
      }
    } catch (error) {
      toast.error("Failed to delete job");
      console.error(error);
    }
  };

  // Get the true update time (ignoring run updates)
  const getTrueUpdateTime = (job: Job): string | null | undefined => {
    // Only show updatedAt if it's different from createdAt (indicating an actual update)
    if (!job.updatedAt || job.updatedAt === job.createdAt) {
      return null; // This will make formatDate/formatRelativeDate show "No date"
    }

    // If lastRunAt exists and dates match within 5 seconds, it means updatedAt was from a run, not an edit
    if (job.lastRunAt && datesMatch(job.updatedAt, job.lastRunAt)) {
      // Return null to indicate no manual update
      return null;
    }

    // Return the actual updatedAt time
    return job.updatedAt;
  };

  // Don't render until component is mounted
  if (!isMounted) {
    return (
      <div className="flex h-full flex-col space-y-4 p-2 mt-6 w-full max-w-full overflow-x-hidden">
        <DataTableSkeleton columns={6} rows={3} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4 p-2 mt-6 w-full max-w-full overflow-x-hidden">
      <DataTable
        data={jobs}
        columns={columns}
        isLoading={isLoading}
        onRowClick={(row) => {
          handleJobSelect(row.original);
        }}
        meta={{
          onDeleteJob: handleDeleteJob,
        }}
      />

      <Sheet open={isSheetOpen} onOpenChange={(open) => {
        if (!open) {
          handleJobSheetClose();
        }
      }}>
        <SheetContent className="xl:max-w-[950px] lg:max-w-[800px] md:max-w-[700px] sm:max-w-[600px] overflow-y-auto p-8">
          {selectedJob && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-2xl font-semibold">
                    Job Details
                  </SheetTitle>
                  <div className="flex items-center space-x-2">
                    {/* Alert Status Icon */}
                    <div className="relative group">
                      <div
                        className={`flex items-center justify-center h-10 w-10 rounded-full ${selectedJob.alertConfig?.enabled
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : 'bg-gray-100 dark:bg-gray-700/30'
                          }`}
                      >
                        {selectedJob.alertConfig?.enabled ? (
                          <Bell className="h-5 w-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <BellOff className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        )}
                      </div>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                        {selectedJob.alertConfig?.enabled ? "Alerts enabled" : "Alerts disabled"}
                      </div>
                    </div>
                    {selectedJob.alertConfig?.enabled && (
                      <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                        {selectedJob.alertConfig.alertOnSuccess && (
                          <div className="relative group">
                            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-500" />
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                              Job success alert
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={hasEditPermission ? () =>
                        router.push(`/jobs/edit/${selectedJob.id}`)
                        : undefined}
                      disabled={!hasEditPermission}
                      className={`mr-2 ${!hasEditPermission ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Edit className="h-4 w-4 mr-2 " />
                      Edit
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!hasEditPermission}
                          className={`${!hasEditPermission ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the job
                            and all associated run history.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDeleteJob(selectedJob.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-2">
                {/* Job ID and Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-card p-4 rounded-lg border border-border/40">
                  <div className="space-y-1">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Job ID
                    </h3>
                    <div className="group relative">
                      <UUIDField
                        value={selectedJob.id}
                        className="text-sm font-mono"
                        onCopy={() =>
                          toast.success("Job ID copied to clipboard")
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Name
                    </h3>
                    <p className="text-sm font-medium">{selectedJob.name}</p>
                  </div>
                </div>

                <Tabs defaultValue="details" className="mt-6">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="tests">
                      Linked Tests
                      <code className="font-mono text-xs font-semibold px-2 py-0.5 bg-card rounded-sm ml-2">
                        {selectedJob.tests?.length || 0}
                      </code>

                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="details" className="py-4 space-y-6">
                    {/* Status and Schedule in a grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Status */}
                      <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Status</h3>
                        <div className="flex items-center space-x-2">
                          {(() => {
                            const status = jobStatuses.find(
                              (s) => s.value === selectedJob.status,
                            );
                            return status ? (
                              <>
                                {status.icon && (
                                  <status.icon
                                    className={`h-5 w-5 ${status.color}`}
                                  />
                                )}
                                <span className="text-sm">
                                  {status.label}
                                </span>
                              </>
                            ) : null;
                          })()}
                        </div>
                      </div>

                      {/* Schedule */}
                      <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Schedule</h3>
                        <div className="flex items-center space-x-2">
                          <TimerIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {selectedJob.cronSchedule || "None"}
                          </span>
                        </div>
                      </div>
                    </div>


                    {/* Description */}
                    <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                      <h3 className="text-xs font-medium text-muted-foreground">Description</h3>
                      <p className="text-sm text-muted-foreground">
                        {selectedJob.description || "No description provided"}
                      </p>
                    </div>

                    {/* Timing Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Last Run</h3>
                        <div>
                          <p className="text-sm">
                            {formatDate(selectedJob.lastRunAt)}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            {formatRelativeDate(selectedJob.lastRunAt)}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Next Run</h3>
                        <div>
                          <p className="text-sm">
                            {formatDate(selectedJob.nextRunAt)}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center">
                            <ClockIcon className="h-3 w-3 mr-1" />
                            {formatRelativeDate(selectedJob.nextRunAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Timestamps */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Created</h3>
                        <div>
                          <p className="text-sm">
                            {formatDate(selectedJob.createdAt)}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            {formatRelativeDate(selectedJob.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                        <h3 className="text-xs font-medium text-muted-foreground">Updated</h3>
                        <div>
                          <p className="text-sm">
                            {formatUpdateDate(getTrueUpdateTime(selectedJob))}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center">
                            <Edit className="h-3 w-3 mr-1" />
                            {formatUpdateRelativeDate(getTrueUpdateTime(selectedJob))}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Remote API Trigger */}
                    <div className="space-y-4 bg-card p-4 rounded-lg border border-border/40">
                      <div className="flex items-center gap-2">
                        {/* <Key className="h-4 w-4 text-muted-foreground" /> */}
                        <h3 className="text-xs font-medium text-muted-foreground">CI/CD Remote Job Trigger</h3>
                        <UrlTriggerTooltip jobId={selectedJob.id} />
                      </div>

                      <div className="space-y-3">

                        <div className="space-y-2">
                          {/* <h4 className="text-sm font-medium">Curl</h4> */}
                          <div className="relative">
                            <pre className="p-3 bg-muted rounded text-xs overflow-x-auto">
                              {`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/jobs/${selectedJob.id}/trigger" \\
-H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}

                            </pre>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute top-2 right-2"
                              onClick={() => {
                                const curlCommand = `curl -X POST "${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/jobs/${selectedJob.id}/trigger" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json"`;
                                navigator.clipboard.writeText(curlCommand);
                                toast.success("Curl command copied to clipboard");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>



                        <div className="text-xs text-muted-foreground space-y-1">
                          <p><strong>Note:</strong> You need to create an API key first in the job settings and replace <i> YOUR_API_KEY</i> with actual API key.</p>
                          <p><strong>Response:</strong> Returns JSON with job execution details and run ID.</p>
                          {/* <p><strong>Rate Limits:</strong> API keys have configurable rate limits and expiration.</p> */}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="tests" className="py-4 space-y-4">
                    {selectedJob.tests && selectedJob.tests.length > 0 ? (
                      <JobTestDataTable
                        columns={createJobTestColumns()}
                        data={selectedJob.tests}
                        className="border-0"
                      />
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No tests configured for this job.
                      </div>
                    )}
                  </TabsContent>
                </Tabs>

                {/* Edit Test Dialog */}
                <Dialog
                  open={isEditTestDialogOpen}
                  onOpenChange={setIsEditTestDialogOpen}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Test</DialogTitle>
                      <DialogDescription>
                        Update the test details.
                      </DialogDescription>
                    </DialogHeader>
                    {selectedTest && (
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="edit-test-id" className="text-right">
                            ID
                          </Label>
                          <Input
                            id="edit-test-id"
                            value={selectedTest.id}
                            className="col-span-3"
                            disabled
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="edit-test-name"
                            className="text-right"
                          >
                            Name
                          </Label>
                          <Input
                            id="edit-test-name"
                            value={selectedTest.name}
                            onChange={(e) =>
                              setSelectedTest({
                                ...selectedTest,
                                name: e.target.value,
                              })
                            }
                            className="col-span-3"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="edit-test-description"
                            className="text-right"
                          >
                            Description
                          </Label>
                          <Textarea
                            id="edit-test-description"
                            value={selectedTest.description || ""}
                            onChange={(e) =>
                              setSelectedTest({
                                ...selectedTest,
                                description: e.target.value,
                              })
                            }
                            className="col-span-3"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="edit-test-type"
                            className="text-right"
                          >
                            Type
                          </Label>
                          <Select
                            // Display the current type, even if legacy
                            value={selectedTest?.type || ""}
                            // onValueChange receives a valid Test["type"]
                            onValueChange={(value: Test["type"]) => {
                              setSelectedTest((prev) =>
                                // Update directly with the valid type from SelectItem
                                prev ? { ...prev, type: value } : null,
                              );
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {/* Only show valid Test['type'] options */}
                              <SelectItem value="browser">Browser</SelectItem>
                              <SelectItem value="api">API</SelectItem>
                              <SelectItem value="custom">
                                Custom
                              </SelectItem>
                              <SelectItem value="database">Database</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="edit-test-status"
                            className="text-right"
                          >
                            Status
                          </Label>
                          <Select
                            value={selectedTest.status || "pending"}
                            onValueChange={(value) => {
                              // Map the UI status values to the DB status values
                              const statusMap: Record<string, "running" | "passed" | "failed" | "error" | undefined> = {
                                "pass": "passed",
                                "fail": "failed",
                                "pending": "running",
                                "skipped": undefined
                              };

                              setSelectedTest({
                                ...selectedTest,
                                status: statusMap[value]
                              });
                            }}
                          >
                            <SelectTrigger className="col-span-3">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pass">Pass</SelectItem>
                              <SelectItem value="fail">Fail</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="skipped">Skipped</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setIsEditTestDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleEditTest}>Save Changes</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div >
  );
}
