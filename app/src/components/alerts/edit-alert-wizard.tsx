"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationProviderForm } from "./notification-provider-form";
import { AlertSettings } from "./alert-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { type NotificationProviderType, type NotificationProviderConfig } from "@/db/schema";

interface NotificationProviderData {
  id: string;
  name: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
  enabled: boolean;
  maskedFields?: string[];
}

interface AlertConfig {
  enabled: boolean;
  notificationProviders: string[];
  alertOnFailure: boolean;
  alertOnRecovery: boolean;
  alertOnSslExpiration: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  customMessage: string;
}

interface EditAlertWizardProps {
  providerId: string;
  initialData: NotificationProviderData;
}

export function EditAlertWizard({ providerId, initialData }: EditAlertWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [providerData, setProviderData] = useState(initialData);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    enabled: true,
    notificationProviders: [providerId],
    alertOnFailure: true,
    alertOnRecovery: true,
    alertOnSslExpiration: false,
    failureThreshold: 1,
    recoveryThreshold: 1,
    customMessage: "",
  });

  const steps = [
    {
      title: "Provider Settings",
      description: "Configure notification provider details",
      component: (
        <NotificationProviderForm
          initialData={providerData}
          onSuccess={handleProviderSave}
          onCancel={() => router.push("/alerts")}
        />
      )
    },
    {
      title: "Alert Configuration",
      description: "Configure alert settings and preferences",
      component: (
        <div className="space-y-6">
          <AlertSettings
            value={alertConfig}
            onChange={(config) => setAlertConfig({
              enabled: config.enabled,
              notificationProviders: config.notificationProviders,
              alertOnFailure: config.alertOnFailure,
              alertOnRecovery: config.alertOnRecovery || false,
              alertOnSslExpiration: config.alertOnSslExpiration || false,
              failureThreshold: config.failureThreshold,
              recoveryThreshold: config.recoveryThreshold,
              customMessage: config.customMessage || "",
            })}
            context="monitor"
          />
          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep(0)}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleFinalSave}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      )
    }
  ];

  async function handleProviderSave(data: { type: NotificationProviderType; config: NotificationProviderConfig }) {
    try {
      const response = await fetch(`/api/notification-providers/${providerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: providerId,
          name: (data.config as Record<string, unknown>).name,
          type: data.type,
          config: data.config,
          enabled: providerData.enabled,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update provider');
      }

      const updatedProvider = await response.json();
      setProviderData(updatedProvider);
      setCurrentStep(1); // Move to next step
      toast.success("Provider settings updated successfully");
    } catch (error) {
      console.error('Error updating provider:', error);
      toast.error("Failed to update provider settings");
    }
  }

  async function handleFinalSave() {
    try {
      // Here you would save the alert configuration
      // For now, just show success and redirect
      toast.success("Alert settings saved successfully");
      router.push("/alerts");
    } catch (error) {
      console.error('Error saving alert settings:', error);
      toast.error("Failed to save alert settings");
    }
  }

  const currentStepData = steps[currentStep];

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {currentStepData.title}
              </CardTitle>
              <CardDescription className="mt-2">
                {currentStepData.description}
              </CardDescription>
            </div>
            <div className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {currentStepData.component}
        </CardContent>
      </Card>
    </div>
  );
} 
