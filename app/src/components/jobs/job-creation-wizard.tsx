"use client";

import React, { useState } from "react";
import { CreateJob } from "./create-job";
import { AlertSettings } from "@/components/alerts/alert-settings";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";
import { Test } from "./schema";

interface JobAlertConfig {
  enabled: boolean;
  notificationProviders: string[];
  alertOnFailure: boolean;
  alertOnSuccess: boolean;
  alertOnTimeout: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  customMessage?: string;
}

export function JobCreationWizard() {
  const [currentStep, setCurrentStep] = useState<"job" | "alerts">("job");
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
    alertOnSuccess: false,
    alertOnTimeout: true,
    failureThreshold: 1,
    recoveryThreshold: 1,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJobNext = (data: Record<string, unknown>) => {
    setFormData({
      name: (data.name as string) || "",
      description: (data.description as string) || "",
      cronSchedule: (data.cronSchedule as string) || "",
      tests: Array.isArray(data.tests) ? data.tests : [],
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
        jobType: "playwright" as const,
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

  // Step 1: Job Details
  if (currentStep === "job") {
    return (
      <CreateJob
        onSave={handleJobNext}
        onCancel={() => window.history.back()}
        hideAlerts={true}
        initialValues={formData}
        selectedTests={formData.tests}
        setSelectedTests={(tests) =>
          setFormData((prev) => ({
            ...prev,
            tests: Array.isArray(tests) ? tests : [],
          }))
        }
      />
    );
  }

  // Step 2: Alert Settings
  if (currentStep === "alerts") {
    return (
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
              Configure notifications for job execution events
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AlertSettings
              value={alertConfig}
              onChange={(config) =>
                setAlertConfig({
                  enabled: config.enabled,
                  notificationProviders: config.notificationProviders,
                  alertOnFailure: config.alertOnFailure,
                  alertOnSuccess: config.alertOnSuccess || false,
                  alertOnTimeout: config.alertOnTimeout || false,
                  failureThreshold: config.failureThreshold,
                  recoveryThreshold: config.recoveryThreshold,
                  customMessage: config.customMessage,
                })
              }
              context="job"
            />

            <div className="flex justify-end gap-6 pt-4">
              <Button variant="outline" onClick={handleAlertsBack}>
                Back
              </Button>
              <Button onClick={handleAlertsNext} disabled={isSubmitting}>
                {isSubmitting ? "Creating Job..." : "Create Job"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // This should never be reached since we only have 2 steps now
  return null;
}
