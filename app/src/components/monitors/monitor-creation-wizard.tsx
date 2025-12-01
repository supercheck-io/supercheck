"use client";

import React, { useState, useEffect } from "react";
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
import { useAppConfig } from "@/hooks/use-app-config";

type WizardStep = "monitor" | "location" | "alerts";

export function MonitorCreationWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepFromUrl = searchParams?.get('wizardStep') as WizardStep | null;
  const { maxMonitorNotificationChannels } = useAppConfig();

  // Restore draft data from sessionStorage
  const getInitialMonitorData = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('monitor-draft-data');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };

  const getInitialApiData = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('monitor-draft-api');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };

  const getInitialLocationConfig = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('monitor-draft-location');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return DEFAULT_LOCATION_CONFIG;
        }
      }
    }
    return DEFAULT_LOCATION_CONFIG;
  };

  const getInitialAlertConfig = () => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('monitor-draft-alert');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return {
            enabled: false,
            notificationProviders: [],
            alertOnFailure: true,
            alertOnRecovery: true,
            alertOnSslExpiration: false,
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
      alertOnSslExpiration: false,
      failureThreshold: 1,
      recoveryThreshold: 1,
    };
  };

  const [currentStep, setCurrentStep] = useState<WizardStep>(stepFromUrl || "monitor");
  const [monitorData, setMonitorData] = useState<FormValues | undefined>(getInitialMonitorData());
  const [apiData, setApiData] = useState<Record<string, unknown> | undefined>(getInitialApiData());
  const [locationConfig, setLocationConfig] = useState<LocationConfig>(getInitialLocationConfig());
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(getInitialAlertConfig());

  // Persist data to sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (monitorData) {
        sessionStorage.setItem('monitor-draft-data', JSON.stringify(monitorData));
      }
    }
  }, [monitorData]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (apiData) {
        sessionStorage.setItem('monitor-draft-api', JSON.stringify(apiData));
      }
    }
  }, [apiData]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('monitor-draft-location', JSON.stringify(locationConfig));
    }
  }, [locationConfig]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('monitor-draft-alert', JSON.stringify(alertConfig));
    }
  }, [alertConfig]);

  // Sync URL with current step
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentStep === "monitor") {
      params.delete('wizardStep');
    } else {
      params.set('wizardStep', currentStep);
    }
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    router.replace(newUrl, { scroll: false });
  }, [currentStep, router]);

  // Clear draft data
  const clearDraft = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('monitor-draft-data');
      sessionStorage.removeItem('monitor-draft-api');
      sessionStorage.removeItem('monitor-draft-location');
      sessionStorage.removeItem('monitor-draft-alert');
    }
  };

  // Get monitor type from URL for dynamic title
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
      if (alertConfig.notificationProviders.length > maxMonitorNotificationChannels) {
        toast.error("Validation Error", {
          description: `You can only select up to ${maxMonitorNotificationChannels} notification channels`,
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

        // Clear draft data
        clearDraft();

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
