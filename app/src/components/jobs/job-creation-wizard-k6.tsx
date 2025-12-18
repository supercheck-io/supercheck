"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreateJob } from "./create-job";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Test } from "./schema";
import { type AlertConfig } from "@/db/schema";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQueryClient } from "@tanstack/react-query";
import { JOBS_QUERY_KEY } from "@/hooks/use-jobs";

type JobAlertConfig = AlertConfig;

export function JobCreationWizardK6() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const stepFromUrl = searchParams.get('step') as "job" | "alerts" | null;
  const { maxJobNotificationChannels } = useAppConfig();

  // Restore form data from sessionStorage if available (survives page refresh)
  const getInitialFormData = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('k6-job-draft');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return { name: "", description: "", cronSchedule: "", tests: [] as Test[] };
        }
      }
    }
    return { name: "", description: "", cronSchedule: "", tests: [] as Test[] };
  };

  const getInitialTest = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('k6-job-test-draft');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  const getInitialAlertConfig = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('k6-job-alert-draft');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return {
            enabled: false,
            notificationProviders: [],
            alertOnFailure: true,
            alertOnRecovery: true,
            alertOnSuccess: false,
            alertOnTimeout: true,
            failureThreshold: 1,
            recoveryThreshold: 1,
          };
        }
      }
    }
    return {
      enabled: false,
      notificationProviders: [],
      alertOnFailure: true,
      alertOnRecovery: true,
      alertOnSuccess: false,
      alertOnTimeout: true,
      failureThreshold: 1,
      recoveryThreshold: 1,
    };
  };

  const [currentStep, setCurrentStep] = useState<"job" | "alerts">(stepFromUrl || "job");
  const [selectedTest, setSelectedTest] = useState<Test | null>(getInitialTest());
  const [formData, setFormData] = useState(getInitialFormData());
  const [alertConfig, setAlertConfig] = useState<JobAlertConfig>(getInitialAlertConfig());

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Persist form data to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('k6-job-draft', JSON.stringify(formData));
    }
  }, [formData]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (selectedTest) {
        sessionStorage.setItem('k6-job-test-draft', JSON.stringify(selectedTest));
      } else {
        sessionStorage.removeItem('k6-job-test-draft');
      }
    }
  }, [selectedTest]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('k6-job-alert-draft', JSON.stringify(alertConfig));
    }
  }, [alertConfig]);

  // Clear sessionStorage on successful submission
  const clearDraft = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('k6-job-draft');
      sessionStorage.removeItem('k6-job-test-draft');
      sessionStorage.removeItem('k6-job-alert-draft');
    }
  };

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

  const handleJobNext = (data: Record<string, unknown>) => {
    // Validate that a test is selected (required for k6 jobs)
    if (!selectedTest) {
      toast.error("Validation Error", {
        description: "Please select a performance test for the job"
      });
      return;
    }

    // For K6 jobs, only allow single performance test
    const tests = selectedTest ? [selectedTest] : [];

    setFormData({
      name: (data.name as string) || "",
      description: (data.description as string) || "",
      cronSchedule: (data.cronSchedule as string) || "",
      tests: tests,
    });
    setCurrentStep("alerts");
  };

  const handleAlertsNext = () => {
    // Validate alert configuration before proceeding
    if (alertConfig.enabled) {
      // Check if at least one notification provider is selected
      if (
        !alertConfig.notificationProviders ||
        alertConfig.notificationProviders.length === 0
      ) {
        toast.error("Validation Error", {
          description:
            "At least one notification channel must be selected when alerts are enabled",
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
        alertConfig.alertOnTimeout,
      ].some(Boolean);

      if (!alertTypesSelected) {
        toast.error("Validation Error", {
          description:
            "At least one alert type must be selected when alerts are enabled",
        });
        return;
      }
    }

    handleCreateJob();
  };

  const handleAlertsBack = () => {
    setCurrentStep("job");
  };

  const handleCreateJob = async () => {
    try {
      setIsSubmitting(true);
      const finalData = {
        ...formData,
        alertConfig: alertConfig,
        jobType: "k6" as const,
      };

      // Create job via API
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalData),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success("Success", {
          description: `Job "${finalData.name}" has been created.`,
          duration: 3000,
        });
        // Clear draft data from sessionStorage
        clearDraft();

        // Invalidate Jobs cache to ensure fresh data on jobs page
        queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY, refetchType: 'all' });

        // Use router.push for proper navigation
        router.push("/jobs");
      } else {
        const errorMessage =
          result.error || result.message || "Failed to create job";
        console.error("Failed to create job:", errorMessage);
        toast.error("Failed to create job", {
          description: errorMessage,
        });
      }
    } catch (error) {
      console.error("Failed to create job:", error);
      toast.error("Error", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {currentStep === "job" ? (
        <CreateJob
          hideAlerts={true}
          onSave={handleJobNext}
          onCancel={() => router.push("/jobs/create")}
          selectedTests={selectedTest ? [selectedTest] : []}
          setSelectedTests={(tests) => {
            // For k6 jobs, only allow single test
            if (tests.length > 0) {
              setSelectedTest(tests[0]);
            } else {
              setSelectedTest(null);
            }
          }}
          performanceMode={true}
        />
      ) : (
        <div className="space-y-6 p-4">
          <Card>
            <CardHeader>
              <CardTitle>
                Alert Settings{" "}
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  Optional
                </span>
              </CardTitle>
              <CardDescription>
                Configure notifications for this performance job
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <AlertSettings
                value={alertConfig}
                onChange={setAlertConfig}
                context="job"
              />

              <div className="flex justify-between space-x-4 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAlertsBack}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button onClick={handleAlertsNext} disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Job"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
