"use client";

import React, { useState } from "react";
import { MonitorForm } from "./monitor-form";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { LocationConfigSection } from "./location-config-section";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { MonitorType, AlertConfig } from "@/db/schema";
import { FormValues } from "./monitor-form";
import { DEFAULT_LOCATION_CONFIG } from "@/lib/location-service";
import type { LocationConfig } from "@/lib/location-service";

type WizardStep = "monitor" | "location" | "alerts";

export function MonitorCreationWizard() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>("monitor");
  const [monitorData, setMonitorData] = useState<FormValues | undefined>(
    undefined
  );
  const [apiData, setApiData] = useState<Record<string, unknown> | undefined>(
    undefined
  );
  const [locationConfig, setLocationConfig] = useState<LocationConfig>(
    DEFAULT_LOCATION_CONFIG
  );
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    enabled: false,
    notificationProviders: [],
    alertOnFailure: true,
    alertOnRecovery: true,
    alertOnSslExpiration: false,
    failureThreshold: 1,
    recoveryThreshold: 1,
  });

  // Get monitor type from URL for dynamic title
  const searchParams = useSearchParams();
  const urlType = searchParams?.get("type") || "http_request";
  const validTypes: MonitorType[] = [
    "http_request",
    "website",
    "ping_host",
    "port_check",
    "synthetic_test",
  ];
  const type = validTypes.includes(urlType as MonitorType)
    ? (urlType as MonitorType)
    : "http_request";
  const typeLabel = type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Don't clear monitor data when URL changes - preserve form state
  // This was causing the form to lose data when navigating between pages

  const handleMonitorNext = (data: Record<string, unknown>) => {
    // Extract form data and API data from the passed object
    const { formData, apiData: monitorApiData } = data as {
      formData: FormValues;
      apiData: Record<string, unknown>;
    };

    // Store the form data for state persistence and API data for creation
    setMonitorData(formData);
    setApiData(monitorApiData);
    setCurrentStep("location");
  };

  const handleLocationNext = () => {
    setCurrentStep("alerts");
  };

  const handleBackFromLocation = () => {
    setCurrentStep("monitor");
  };

  const handleBackFromAlerts = () => {
    setCurrentStep("location");
  };

  const handleCancel = () => {
    router.push("/monitors");
  };

  const handleCreateMonitor = async () => {
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
      const maxMonitorChannels = parseInt(
        process.env.NEXT_PUBLIC_MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (alertConfig.notificationProviders.length > maxMonitorChannels) {
        toast.error("Validation Error", {
          description: `You can only select up to ${maxMonitorChannels} notification channels`,
        });
        return;
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        toast.error("Validation Error", {
          description:
            "At least one alert type must be selected when alerts are enabled",
        });
        return;
      }
    }

    try {
      // Include location config in the monitor config
      const configWithLocation = {
        ...(apiData?.config || {}),
        locationConfig,
      };

      const finalData = {
        ...apiData,
        config: configWithLocation,
        alertConfig: alertConfig,
      };

      // Create monitor via API
      const response = await fetch("/api/monitors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalData),
      });

      if (response.ok) {
        toast.success("Monitor created successfully");

        // Redirect to monitors list using router
        router.push("/monitors");
      } else {
        const errorData = await response.json();
        console.error("Failed to create monitor:", errorData);

        // Show error as toast
        toast.error("Failed to create monitor", {
          description: errorData.error || "An unknown error occurred",
        });
      }
    } catch (error) {
      console.error("Failed to create monitor:", error);

      // Show error as toast
      toast.error("Failed to create monitor", {
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    }
  };

  // Step 1: Monitor Configuration
  if (currentStep === "monitor") {
    return (
      <div className="space-y-4">
        <MonitorForm
          onSave={handleMonitorNext}
          onCancel={handleCancel}
          hideAlerts={true}
          monitorType={type as MonitorType}
          title={`${typeLabel} Monitor`}
          description="Configure a new uptime monitor"
          // Pass monitorData to preserve state when navigating back
          initialData={monitorData}
        />
      </div>
    );
  }

  // Step 2: Location Configuration
  if (currentStep === "location") {
    return (
      <div className="space-y-6 p-4">
        <Card>
          <CardHeader>
            <CardTitle>
              Location Settings{" "}
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Optional
              </span>
            </CardTitle>
            <CardDescription>
              Configure multi-location monitoring for better reliability and
              global coverage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <LocationConfigSection
              value={locationConfig}
              onChange={setLocationConfig}
            />
            <div className="flex justify-end gap-4 pt-4">
              <Button variant="outline" onClick={handleBackFromLocation}>
                Back
              </Button>
              <Button onClick={handleLocationNext}>Next: Alerts</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 3: Alert Configuration
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
            Configure notifications for this monitor
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
                alertOnRecovery: config.alertOnRecovery || false,
                alertOnSslExpiration: config.alertOnSslExpiration || false,
                failureThreshold: config.failureThreshold,
                recoveryThreshold: config.recoveryThreshold,
                customMessage: config.customMessage,
              })
            }
            context="monitor"
            monitorType={monitorData?.type || type}
            sslCheckEnabled={
              monitorData?.type === "website" &&
              !!monitorData?.websiteConfig_enableSslCheck
            }
          />
          <div className="flex justify-end gap-4 pt-4">
            <Button variant="outline" onClick={handleBackFromAlerts}>
              Back
            </Button>
            <Button onClick={handleCreateMonitor}>Create Monitor</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
