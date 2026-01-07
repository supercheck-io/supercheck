"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Test } from "./schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveIcon, Trash2, Loader2 } from "lucide-react";
import { updateJob } from "@/actions/update-job";
// import { getJob } from "@/actions/get-jobs"; // Replaced with API call
import { deleteJob } from "@/actions/delete-job";
import { toast } from "sonner";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/form";
import { ControllerRenderProps } from "react-hook-form";
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
import TestSelector from "@/components/shared/test-selector";
import CronScheduler from "./cron-scheduler";

import NextRunDisplay from "./next-run-display";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { CicdSettings } from "./cicd-settings";
import { EditJobSkeleton } from "./edit-job-skeleton";
import { UrlTriggerTooltip } from "./url-trigger-tooltip";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQueryClient } from "@tanstack/react-query";
import { JOBS_QUERY_KEY, type Job, type JobTest } from "@/hooks/use-jobs";


interface AlertConfiguration {
  enabled: boolean;
  notificationProviders: string[];
  alertOnFailure: boolean;
  alertOnRecovery?: boolean;
  alertOnSslExpiration?: boolean;
  alertOnSuccess?: boolean;
  alertOnTimeout?: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  customMessage?: string;
}

const jobFormSchema = z.object({
  name: z.string().min(1, "Job name is required"),
  description: z.string().min(1, "Job description is required"),
  cronSchedule: z.string().optional(),
});

type FormData = z.infer<typeof jobFormSchema>;

interface EditJobProps {
  jobId: string;
  initialJobData?: Job; // Pre-fetched job data from page.tsx to avoid duplicate API calls
}

export default function EditJob({ jobId, initialJobData }: EditJobProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const stepFromUrl = searchParams.get('step') as 'job' | 'alerts' | 'cicd' | null;
  const { maxJobNotificationChannels } = useAppConfig();

  const [selectedTests, setSelectedTests] = useState<Test[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submissionAttempted, setSubmissionAttempted] = useState(false);
  const [isPerformanceJob, setIsPerformanceJob] = useState(false);

  // Check permissions for job deletion
  const { currentProject } = useProjectContext();
  const userRole = currentProject?.userRole ? normalizeRole(currentProject.userRole) : null;
  const canDeleteJob = userRole ? canDeleteJobs(userRole) : false;
  const [formChanged, setFormChanged] = useState(false);

  // Single source of truth for initial form state
  const [initialFormState, setInitialFormState] = useState({
    name: "",
    description: "",
    cronSchedule: "",
    tests: [] as Test[],
    alertConfig: {
      enabled: false,
      notificationProviders: [],
      alertOnFailure: true,
      alertOnSuccess: false,
      alertOnTimeout: true,
      failureThreshold: 1,
      recoveryThreshold: 1,
      customMessage: "",
    } as AlertConfiguration
  });

  const [alertConfig, setAlertConfig] = useState<AlertConfiguration>({
    enabled: false,
    notificationProviders: [],
    alertOnFailure: true,
    alertOnSuccess: false,
    alertOnTimeout: true,
    failureThreshold: 1,
    recoveryThreshold: 1,
    customMessage: "",
  });
  const [currentStep, setCurrentStep] = useState<'job' | 'alerts' | 'cicd'>(stepFromUrl || 'job');
  const [apiKeysChanged, setApiKeysChanged] = useState(false);

  // Sync URL with current step
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentStep === "job") {
      params.delete('step');
    } else {
      params.set('step', currentStep);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl, { scroll: false });
  }, [currentStep, router]);

  // Warn user before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (formChanged) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [formChanged]);


  const form = useForm<FormData>({
    resolver: zodResolver(jobFormSchema),
    mode: "onSubmit", // Only validate on submit, not on every change
    defaultValues: {
      name: "",
      description: "",
      cronSchedule: "",
    },
  });

  // Watch form values for changes
  const watchedValues = form.watch();

  // Process job data either from props (initialJobData) or refetch
  // This eliminates duplicate API calls - data is fetched once in page.tsx
  useEffect(() => {
    if (!initialJobData) {
      // No initial data - shouldn't happen in normal flow
      toast.error("Error", {
        description: "Job data not available. Redirecting to jobs list.",
      });
      router.push("/jobs");
      return;
    }

    // Process the initial job data
    const jobData = initialJobData;

    // Set form values
    const formValues = {
      name: jobData.name,
      description: jobData.description || "",
      cronSchedule: jobData.cronSchedule || "",
    };

    form.reset(formValues);

    // Map the tests to the format expected by TestSelector
    const tests = (jobData.tests || []).map((test: JobTest) => ({
      id: test.id,
      name: test.name || test.title || "",
      description: test.description || null,
      type: (test.type as "browser" | "api" | "custom" | "database" | "performance") || "browser",
      status: "running" as const,
      lastRunAt: null,
      duration: null,
      tags: test.tags || [],
    }));

    setSelectedTests(tests);

    // Detect if this is a k6 (performance) job or Playwright job
    const allPerformanceTests = tests.length > 0 && tests.every((test) => test.type === "performance");
    setIsPerformanceJob(allPerformanceTests);

    // Load alert configuration if it exists
    const alertConfigData: AlertConfiguration = {
      enabled: false,
      notificationProviders: [],
      alertOnFailure: true,
      alertOnSuccess: false,
      alertOnTimeout: true,
      failureThreshold: 1,
      recoveryThreshold: 1,
      customMessage: "",
    };

    if (jobData.alertConfig && typeof jobData.alertConfig === 'object') {
      const ac = jobData.alertConfig;
      alertConfigData.enabled = Boolean(ac.enabled);
      alertConfigData.notificationProviders = Array.isArray(ac.notificationProviders) ? ac.notificationProviders : [];
      alertConfigData.alertOnFailure = ac.alertOnFailure !== undefined ? Boolean(ac.alertOnFailure) : true;
      alertConfigData.alertOnSuccess = Boolean(ac.alertOnSuccess);
      alertConfigData.alertOnTimeout = ac.alertOnTimeout !== undefined ? Boolean(ac.alertOnTimeout) : true;
      alertConfigData.failureThreshold = typeof ac.failureThreshold === 'number' ? ac.failureThreshold : 1;
      alertConfigData.recoveryThreshold = typeof ac.recoveryThreshold === 'number' ? ac.recoveryThreshold : 1;
      alertConfigData.customMessage = typeof ac.customMessage === 'string' ? ac.customMessage : "";
    }

    setAlertConfig(alertConfigData);

    // Store complete initial state for change detection
    setInitialFormState({
      name: formValues.name,
      description: formValues.description,
      cronSchedule: formValues.cronSchedule,
      tests: tests,
      alertConfig: alertConfigData
    });

    // Reset form changed state after processing
    setFormChanged(false);
    setApiKeysChanged(false);
    setIsLoading(false);
  }, [initialJobData, router, form]);

  // Handle form submission for job details
  const handleJobNext = form.handleSubmit(async () => {
    setSubmissionAttempted(true);

    try {
      // Validate that at least one test is selected
      if (selectedTests.length === 0) {
        toast.error("Validation Error", {
          description: "Please select at least one test for the job",
        });
        return;
      }

      // Prepare job data for next step
      setCurrentStep('alerts');
    } catch (error) {
      console.error("Error preparing job data:", error);
      toast.error("Error", {
        description: "Failed to prepare job data. Please try again.",
      });
    }
  });

  // Handle final submission with alerts
  const handleFinalSubmit = async () => {
    try {
      // Validate alert configuration before proceeding
      if (alertConfig.enabled) {
        // Check if at least one notification provider is selected
        if (!alertConfig.notificationProviders || alertConfig.notificationProviders.length === 0) {
          toast.error("Validation Error", {
            description: "At least one notification channel must be selected when alerts are enabled",
          });
          return;
        }

        // Check notification channel limit
        if (alertConfig.notificationProviders.length > maxJobNotificationChannels) {
          toast.error("Validation Error", {
            description: `You can only select up to ${maxJobNotificationChannels} notification channels`,
          });
          return;
        }

        // Check if at least one alert type is selected
        const alertTypesSelected = [
          alertConfig.alertOnFailure,
          alertConfig.alertOnSuccess,
          alertConfig.alertOnTimeout
        ].some(Boolean);

        if (!alertTypesSelected) {
          toast.error("Validation Error", {
            description: "At least one alert type must be selected when alerts are enabled",
          });
          return;
        }
      }

      setIsSubmitting(true);

      const finalJobData = {
        jobId: jobId,
        name: watchedValues.name,
        description: watchedValues.description,
        tests: selectedTests.map(test => ({ id: test.id })),
        cronSchedule: watchedValues.cronSchedule,
        alertConfig: alertConfig,
      };

      // Submit the job data
      const response = await updateJob(finalJobData);

      if (!response.success) {
        throw new Error(typeof response.error === 'string' ? response.error : "Failed to update job");
      }

      toast.success("Success", {
        description: "Job updated successfully.",
        duration: 5000,
      });

      // Invalidate Jobs cache to ensure fresh data on jobs list and details
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ["job", jobId], refetchType: 'all' });

      // Navigate to jobs page after successful update
      router.push("/jobs");
    } catch (error) {
      console.error("Error updating job:", error);
      toast.error("Error", {
        description:
          error instanceof Error ? error.message : "Failed to update job. Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle the selection of tests from the TestSelector component
  const handleTestsSelected = (tests: Test[]) => {
    setSelectedTests(tests);
  };

  // Simplified form change detection using single initial state
  useEffect(() => {
    if (isLoading) return;

    const currentName = watchedValues.name || "";
    const currentDescription = watchedValues.description || "";
    const currentCronSchedule = watchedValues.cronSchedule || "";

    // Check form field changes
    const formFieldsChanged =
      currentName !== initialFormState.name ||
      currentDescription !== initialFormState.description ||
      currentCronSchedule !== initialFormState.cronSchedule;

    // Check tests changes by comparing IDs AND their order (not sorted)
    // Order matters for job execution sequence
    const currentTestIds = selectedTests.map(t => t.id).join(',');
    const initialTestIds = initialFormState.tests.map(t => t.id).join(',');
    const testsChanged = currentTestIds !== initialTestIds;

    // Check alert config changes using JSON comparison
    const alertConfigChanged = JSON.stringify({
      ...alertConfig,
      notificationProviders: [...alertConfig.notificationProviders].sort()
    }) !== JSON.stringify({
      ...initialFormState.alertConfig,
      notificationProviders: [...initialFormState.alertConfig.notificationProviders].sort()
    });

    const hasChanges = formFieldsChanged || testsChanged || alertConfigChanged || apiKeysChanged;
    setFormChanged(hasChanges);
  }, [watchedValues, selectedTests, alertConfig, initialFormState, isLoading, apiKeysChanged]);

  // Handle job deletion
  const handleDeleteJob = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteJob(jobId);

      if (!result.success) {
        // If error is "Job not found", job may have been deleted already
        if (result.error === "Job not found") {
          // Show a warning instead of an error
          toast.warning("Job already deleted", {
            description: "This job was already deleted or doesn't exist. Returning to job list."
          });

          // Navigate back to jobs page
          router.push("/jobs");
          return;
        }

        // For other errors, throw the error to be caught below
        throw new Error(result.error || "Failed to delete job");
      }


      toast.success("Job deleted successfully");

      // Invalidate Jobs cache to ensure fresh data on jobs list
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY, refetchType: 'all' });

      router.push("/jobs");
    } catch (error) {
      console.error("Error deleting job:", error);
      toast.error("Failed to delete job", {
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  if (isLoading) {
    return <EditJobSkeleton />;
  }

  // Step 2: Alert Settings
  if (currentStep === 'alerts') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Alert Settings <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span></CardTitle>
            <CardDescription>
              Configure alert notifications for this job
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AlertSettings
              value={alertConfig}
              onChange={(config) => setAlertConfig({
                enabled: config.enabled,
                notificationProviders: config.notificationProviders,
                alertOnFailure: config.alertOnFailure,
                alertOnSuccess: config.alertOnSuccess || false,
                alertOnTimeout: config.alertOnTimeout || false,
                failureThreshold: config.failureThreshold,
                recoveryThreshold: config.recoveryThreshold,
                customMessage: config.customMessage || "",
              })}
              context="job"
            />
            <div className="flex justify-end space-x-4 mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('job')}
                type="button"
              >
                Back
              </Button>
              <Button
                onClick={() => setCurrentStep('cicd')}
                type="button"
              >
                Next: CI/CD Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 3: CI/CD Settings
  if (currentStep === 'cicd') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>CI/CD Settings <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span> <UrlTriggerTooltip jobId={jobId} /></CardTitle>
            <CardDescription>
              Configure API keys to trigger job remotely from your CI/CD pipelines
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <CicdSettings
              jobId={jobId}
              onChange={() => setApiKeysChanged(true)}
            />
            <div className="flex justify-end space-x-4 mt-6">
              <Button
                variant="outline"
                onClick={() => setCurrentStep('alerts')}
                type="button"
              >
                Back
              </Button>
              <Button
                onClick={handleFinalSubmit}
                disabled={isSubmitting || !formChanged}
                className="flex items-center"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <SaveIcon className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Updating..." : "Update Job"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
          <div>
            <CardTitle>Edit Job</CardTitle>
            <CardDescription className="mt-2">
              Update job details and manage associated tests
            </CardDescription>
          </div>
          <div className="flex space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowDeleteDialog(true)}
              disabled={!canDeleteJob || isSubmitting || isDeleting}
              size="sm"
              className={`flex items-center ${!canDeleteJob ? 'opacity-50 cursor-not-allowed text-muted-foreground' : 'text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/50'}`}
              title={canDeleteJob ? "Delete job" : "Insufficient permissions to delete jobs"}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Form {...form}>
            <form onSubmit={handleJobNext} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({
                      field,
                    }: {
                      field: ControllerRenderProps<FormData, "name">;
                    }) => (
                      <FormItem>
                        <FormLabel>Job Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter job name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({
                      field,
                    }: {
                      field: ControllerRenderProps<FormData, "description">;
                    }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Enter job description"
                            className="min-h-[100px]"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="cronSchedule"
                    render={({
                      field,
                    }: {
                      field: ControllerRenderProps<FormData, "cronSchedule">;
                    }) => (
                      <FormItem>
                        <FormLabel className="mb-6">
                          Cron Schedule (UTC){" "}
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>
                        </FormLabel>
                        <FormControl>
                          <CronScheduler
                            value={field.value || ""}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <NextRunDisplay cronExpression={field.value} />
                        <p className="text-xs text-muted-foreground mt-4 flex items-center">
                          <span>Leave empty for manual execution</span>
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <TestSelector
                selectedTests={selectedTests}
                onTestsSelected={handleTestsSelected}
                emptyStateMessage="No tests selected"
                required={submissionAttempted && selectedTests.length === 0}
                performanceMode={isPerformanceJob}
              />

              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  variant="outline"
                  onClick={() => router.push("/jobs")}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  onClick={handleJobNext}
                >
                  Next: Alert Settings
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the job. This action cannot be undone.
              <br /><br />
              <strong>Note:</strong> All the runs related to this job will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteJob();
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 
