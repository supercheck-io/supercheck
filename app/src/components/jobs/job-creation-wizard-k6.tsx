"use client";

import React, { useState } from "react";
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

type JobAlertConfig = AlertConfig;

export function JobCreationWizardK6() {
  const [currentStep, setCurrentStep] = useState<"job" | "alerts">("job");
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    cronSchedule: "",
    tests: [] as Test[],
  });
  const [alertConfig, setAlertConfig] = useState<JobAlertConfig>({
    enabled: false,
    notificationProviders: [],
    alertOnFailure: true,
    alertOnRecovery: true,
    alertOnSuccess: false,
    alertOnTimeout: true,
    failureThreshold: 1,
    recoveryThreshold: 1,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJobNext = (data: Record<string, unknown>) => {
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
      const maxJobChannels = parseInt(
        process.env.NEXT_PUBLIC_MAX_JOB_NOTIFICATION_CHANNELS || "10",
        10
      );
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
        });
        window.location.href = "/jobs";
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
          onCancel={() => (window.location.href = "/jobs")}
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
