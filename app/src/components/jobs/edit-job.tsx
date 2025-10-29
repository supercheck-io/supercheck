"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import TestSelector from "./test-selector";
import CronScheduler from "./cron-scheduler";

import NextRunDisplay from "./next-run-display";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { CicdSettings } from "./cicd-settings";
import { EditJobSkeleton } from "./edit-job-skeleton";
import { UrlTriggerTooltip } from "./url-trigger-tooltip";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";


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
}

export default function EditJob({ jobId }: EditJobProps) {
  const router = useRouter();
  const [selectedTests, setSelectedTests] = useState<Test[]>([]);
  const [originalSelectedTests, setOriginalSelectedTests] = useState<Test[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submissionAttempted, setSubmissionAttempted] = useState(false);

  // Check permissions for job deletion
  const { currentProject } = useProjectContext();
  const userRole = currentProject?.userRole ? normalizeRole(currentProject.userRole) : null;
  const canDeleteJob = userRole ? canDeleteJobs(userRole) : false;
  const [formChanged, setFormChanged] = useState(false);
  const [initialValues, setInitialValues] = useState({
    name: "",
    description: "",
    cronSchedule: ""
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
  const [currentStep, setCurrentStep] = useState<'job' | 'alerts' | 'cicd'>('job');

  const [initialAlertConfig, setInitialAlertConfig] = useState<AlertConfiguration>({
    enabled: false,
    notificationProviders: [],
    alertOnFailure: true,
    alertOnSuccess: false,
    alertOnTimeout: true,
    failureThreshold: 1,
    recoveryThreshold: 1,
    customMessage: "",
  });
  const [apiKeysChanged, setApiKeysChanged] = useState(false);


  const form = useForm<FormData>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      name: "",
      description: "",
      cronSchedule: "",
    },
  });
  
  // Watch form values for changes
  const watchedValues = form.watch();

  // Load job data
  const loadJob = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/jobs/${jobId}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        // This check is now handled by the server component
        // But we'll still handle it here for robustness
        toast.error("Error", {
          description: data.error || "Job not found. Redirecting to jobs list.",
        });
        router.push("/jobs");
        return;
      }

      const jobData = data;
      
      // Set form values
      const formValues = {
        name: jobData.name,
        description: jobData.description || "",
        cronSchedule: jobData.cronSchedule || "",
      };
      
      form.reset(formValues);
      
      // Store initial values for comparison
      setInitialValues(formValues);

      // Map the tests to the format expected by TestSelector
      const tests = jobData.tests.map((test: Record<string, unknown>) => ({
        id: test.id,
        name: test.name,
        description: test.description || null,
        type: test.type as "browser" | "api" | "custom" | "database",
        status: "running" as const,
        lastRunAt: null,
        duration: null,
        tags: test.tags || [], // <-- Ensure tags are included
      }));

      setSelectedTests(tests);
      setOriginalSelectedTests(tests);

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
        const alertConfig = jobData.alertConfig as Record<string, unknown>; // Safe cast since we checked it's an object
        alertConfigData.enabled = Boolean(alertConfig.enabled);
        alertConfigData.notificationProviders = Array.isArray(alertConfig.notificationProviders) ? (alertConfig.notificationProviders as string[]) : [];
        alertConfigData.alertOnFailure = alertConfig.alertOnFailure !== undefined ? Boolean(alertConfig.alertOnFailure) : true;
        alertConfigData.alertOnSuccess = Boolean(alertConfig.alertOnSuccess);
        alertConfigData.alertOnTimeout = alertConfig.alertOnTimeout !== undefined ? Boolean(alertConfig.alertOnTimeout) : true;
        alertConfigData.failureThreshold = typeof alertConfig.failureThreshold === 'number' ? alertConfig.failureThreshold : 1;
        alertConfigData.recoveryThreshold = typeof alertConfig.recoveryThreshold === 'number' ? alertConfig.recoveryThreshold : 1;
        alertConfigData.customMessage = typeof alertConfig.customMessage === 'string' ? alertConfig.customMessage : "";
      }

      setAlertConfig(alertConfigData);
      setInitialAlertConfig(alertConfigData);


      
      // Reset form changed state after successful load
      setFormChanged(false);
      setApiKeysChanged(false);
    } catch (error) {
      console.error("Error loading job:", error);
      toast.error("Error", {
        description: "Failed to load job details. Please try again later.",
      });
      router.push("/jobs");
    } finally {
      setIsLoading(false);
    }
  }, [jobId, router, form]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

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
        const maxJobChannels = parseInt(process.env.NEXT_PUBLIC_MAX_JOB_NOTIFICATION_CHANNELS || '10', 10);
        if (alertConfig.notificationProviders.length > maxJobChannels) {
          toast.error("Validation Error", {
            description: `You can only select up to ${maxJobChannels} notification channels`,
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

  // Check if the form has changed
  useEffect(() => {
    if (isLoading) return;

    const currentName = watchedValues.name || "";
    const currentDescription = watchedValues.description || "";
    const currentCronSchedule = watchedValues.cronSchedule || "";

    const formFieldsChanged =
      currentName !== initialValues.name ||
      currentDescription !== initialValues.description ||
      currentCronSchedule !== initialValues.cronSchedule;

    const testsChanged = !(
      selectedTests.length === originalSelectedTests.length &&
      selectedTests.every(test =>
        originalSelectedTests.some(origTest => origTest.id === test.id)
      ) &&
      originalSelectedTests.every(origTest =>
        selectedTests.some(test => test.id === origTest.id)
      )
    );

    const alertConfigChanged = (
      initialAlertConfig.enabled !== alertConfig.enabled ||
      JSON.stringify(initialAlertConfig.notificationProviders.sort()) !== JSON.stringify(alertConfig.notificationProviders.sort()) ||
      initialAlertConfig.alertOnFailure !== alertConfig.alertOnFailure ||
      initialAlertConfig.alertOnSuccess !== alertConfig.alertOnSuccess ||
      initialAlertConfig.alertOnTimeout !== alertConfig.alertOnTimeout ||
      initialAlertConfig.failureThreshold !== alertConfig.failureThreshold ||
      initialAlertConfig.recoveryThreshold !== alertConfig.recoveryThreshold ||
      (initialAlertConfig.customMessage || "") !== (alertConfig.customMessage || "")
    );

    const hasChanges = formFieldsChanged || testsChanged || alertConfigChanged || apiKeysChanged;
    if (formChanged !== hasChanges) {
      setFormChanged(hasChanges);
    }
  }, [watchedValues, selectedTests, originalSelectedTests, alertConfig, initialAlertConfig, initialValues, isLoading, formChanged, apiKeysChanged]);

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
    <div className="">
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