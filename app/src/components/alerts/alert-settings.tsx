"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Bell, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NotificationProviderForm } from "@/components/alerts/notification-provider-form";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getNotificationProviderConfig } from "@/components/alerts/data";
import { toast } from "sonner";
import {
  type NotificationProviderType,
  type NotificationProviderConfig,
  type AlertConfig,
  type MonitorType,
} from "@/db/schema";
import { useProjectContext } from "@/hooks/use-project-context";
import { canCreateNotifications } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { useAppConfig } from "@/hooks/use-app-config";

interface AlertSettingsProps {
  value?: AlertConfig;
  onChange?: (config: AlertConfig) => void;
  title?: string;
  description?: string;
  hideTitle?: boolean;
  context?: "monitor" | "job";
  monitorType?: MonitorType;
  sslCheckEnabled?: boolean;
}

interface NotificationProvider {
  id: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
}

const defaultConfig: AlertConfig = {
  enabled: false,
  notificationProviders: [],
  alertOnFailure: true,
  alertOnRecovery: true,
  alertOnSslExpiration: false,
  alertOnSuccess: false,
  alertOnTimeout: false,
  failureThreshold: 1,
  recoveryThreshold: 1,
  customMessage: "",
};

export function AlertSettings({
  value = defaultConfig,
  onChange,
  title = "Alert Settings",
  description = "Configure how you want to be notified when this check fails or recovers",
  hideTitle = true,
  context = "monitor",
  monitorType,
  sslCheckEnabled = false,
}: AlertSettingsProps) {
  const { maxJobNotificationChannels, maxMonitorNotificationChannels } =
    useAppConfig();
  const [providers, setProviders] = useState<NotificationProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; // 4 columns * 2 rows
  const [config, setConfig] = useState<AlertConfig>({
    ...defaultConfig,
    ...value,
    notificationProviders: value?.notificationProviders || [],
    // Auto-enable SSL alerts if SSL checking is enabled, force disable if SSL checking is disabled
    alertOnSslExpiration:
      monitorType === "website" && sslCheckEnabled
        ? true
        : monitorType === "website" && !sslCheckEnabled
          ? false
          : value?.alertOnSslExpiration || false,
    // Auto-enable job success alerts for job context
    alertOnSuccess: context === "job" ? true : value?.alertOnSuccess || false,
  });

  // Validation state
  const [validationErrors, setValidationErrors] = useState<{
    notificationProviders?: string;
    alertTypes?: string;
  }>({});

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateNotifications(normalizedRole);

  useEffect(() => {
    // Load providers from API
    const loadProviders = async () => {
      try {
        const response = await fetch("/api/notification-providers");
        if (response.ok) {
          const data = await response.json();
          setProviders(data);
        } else {
          console.error("Failed to fetch notification providers");
          setProviders([]);
        }
      } catch (error) {
        console.error("Error loading notification providers:", error);
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };

    loadProviders();
  }, []);

  // Reset to first page when providers change
  useEffect(() => {
    setCurrentPage(1);
  }, [providers.length]);

  useEffect(() => {
    // Ensure the config always has required properties with defaults
    const safeConfig = {
      ...defaultConfig,
      ...value,
      notificationProviders: value?.notificationProviders || [],
      // Auto-enable SSL alerts if SSL checking is enabled, force disable if SSL checking is disabled
      alertOnSslExpiration:
        monitorType === "website" && sslCheckEnabled
          ? true
          : monitorType === "website" && !sslCheckEnabled
            ? false
            : value?.alertOnSslExpiration || false,
      // Auto-enable job success alerts for job context
      alertOnSuccess: context === "job" ? true : value?.alertOnSuccess || false,
    };
    setConfig(safeConfig);
  }, [value, monitorType, sslCheckEnabled, context]);

  const updateConfig = useCallback(
    (updates: Partial<AlertConfig>) => {
      const newConfig = { ...config, ...updates };
      setConfig(newConfig);
      // Validation is handled by the useEffect below
      onChange?.(newConfig);
    },
    [config, onChange]
  );

  // Auto-enable SSL alerts when SSL checking is enabled, disable when disabled
  useEffect(() => {
    if (monitorType === "website") {
      if (sslCheckEnabled && !config.alertOnSslExpiration) {
        // Auto-enable SSL alerts when SSL checking is enabled
        updateConfig({ alertOnSslExpiration: true });
      } else if (!sslCheckEnabled && config.alertOnSslExpiration) {
        // Auto-disable SSL alerts when SSL checking is disabled
        updateConfig({ alertOnSslExpiration: false });
      }
    }
  }, [monitorType, sslCheckEnabled, config.alertOnSslExpiration, updateConfig]);

  // Auto-enable job success alerts for job context
  useEffect(() => {
    if (context === "job" && !config.alertOnSuccess) {
      updateConfig({ alertOnSuccess: true });
    }
  }, [context, config.alertOnSuccess, updateConfig]);

  // Validate config whenever it changes - using stable reference to avoid loops
  useEffect(() => {
    const errors: { notificationProviders?: string; alertTypes?: string } = {};

    if (config.enabled) {
      if (
        !config.notificationProviders ||
        config.notificationProviders.length === 0
      ) {
        errors.notificationProviders =
          "At least one notification channel must be selected when alerts are enabled";
      }

      const alertTypesSelected = [
        config.alertOnFailure,
        config.alertOnRecovery,
        config.alertOnSuccess,
        config.alertOnTimeout,
        config.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        errors.alertTypes =
          "At least one alert type must be selected when alerts are enabled";
      }
    }

    setValidationErrors(errors);
  }, [
    config.enabled,
    config.notificationProviders,
    config.alertOnFailure,
    config.alertOnRecovery,
    config.alertOnSuccess,
    config.alertOnTimeout,
    config.alertOnSslExpiration,
  ]);

  const toggleProvider = (providerId: string) => {
    const currentProviders = config.notificationProviders || [];
    const maxChannels =
      context === "job"
        ? maxJobNotificationChannels
        : maxMonitorNotificationChannels;

    if (currentProviders.includes(providerId)) {
      // Remove provider
      const newProviders = currentProviders.filter((id) => id !== providerId);
      updateConfig({ notificationProviders: newProviders });
    } else {
      // Add provider - check limit
      if (currentProviders.length >= maxChannels) {
        toast.error("Channel limit reached", {
          description: `You can only select up to ${maxChannels} notification channels.`,
        });
        return;
      }

      const newProviders = [...currentProviders, providerId];
      updateConfig({ notificationProviders: newProviders });
    }
  };

  return (
    <Card>
      {!hideTitle && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      )}
      <CardContent className="space-y-6">
        {/* Enable/Disable Alerts */}
        <div className="flex items-center justify-between mt-6">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <Label htmlFor="alerts-enabled"> Enable Alerts</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Turn on notifications for this check
            </p>
          </div>
          <Switch
            id="alerts-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) => updateConfig({ enabled })}
          />
        </div>

        {config.enabled && (
          <>
            {/* Alert Types */}
            <div className="space-y-4">
              <Label className="text-sm font-medium">Alert Types</Label>
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="alert-failure"
                    checked={config.alertOnFailure}
                    onCheckedChange={(checked) =>
                      updateConfig({ alertOnFailure: checked as boolean })
                    }
                    className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500  :border-blue-500 data-[state=checked]:text-white"
                  />
                  <Label htmlFor="alert-failure" className="text-sm">
                    {context === "job" ? "Job failures" : "Alert on failure"}
                  </Label>
                </div>

                {context === "monitor" && (
                  <>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="alert-recovery"
                        checked={config.alertOnRecovery || false}
                        onCheckedChange={(checked) =>
                          updateConfig({ alertOnRecovery: checked as boolean })
                        }
                        className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500  :border-blue-500 data-[state=checked]:text-white"
                      />
                      <Label htmlFor="alert-recovery" className="text-sm">
                        Alert on recovery
                      </Label>
                    </div>
                    {/* Only show SSL alerts for website monitors with SSL checking enabled */}
                    {monitorType === "website" && sslCheckEnabled && (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="alert-ssl"
                          checked={config.alertOnSslExpiration || false}
                          onCheckedChange={(checked) =>
                            updateConfig({
                              alertOnSslExpiration: checked as boolean,
                            })
                          }
                          className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500  :border-blue-500 data-[state=checked]:text-white"
                        />
                        <Label htmlFor="alert-ssl" className="text-sm">
                          Alert on SSL certificate expiration
                        </Label>
                      </div>
                    )}
                  </>
                )}

                {context === "job" && (
                  <>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="alert-success"
                        checked={config.alertOnSuccess || false}
                        onCheckedChange={(checked) =>
                          updateConfig({ alertOnSuccess: checked as boolean })
                        }
                        className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500  :border-blue-500 data-[state=checked]:text-white"
                      />
                      <Label htmlFor="alert-success" className="text-sm">
                        Job success{" "}
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          completion
                        </span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="alert-timeout"
                        checked={config.alertOnTimeout || false}
                        onCheckedChange={(checked) =>
                          updateConfig({ alertOnTimeout: checked as boolean })
                        }
                        className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500  :border-blue-500 data-[state=checked]:text-white"
                      />
                      <Label htmlFor="alert-timeout" className="text-sm">
                        Job timeouts
                      </Label>
                    </div>
                  </>
                )}
              </div>
              {validationErrors.alertTypes && (
                <p className="text-sm text-destructive">
                  {validationErrors.alertTypes}
                </p>
              )}
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="failure-threshold"
                  className="text-sm font-medium"
                >
                  Failure Threshold
                </Label>
                <p className="text-sm text-muted-foreground">
                  Alert after this many consecutive failures
                </p>
                <Select
                  value={(config.failureThreshold || 1).toString()}
                  onValueChange={(value) =>
                    updateConfig({ failureThreshold: parseInt(value) })
                  }
                >
                  <SelectTrigger id="failure-threshold">
                    <SelectValue placeholder="Select threshold" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 failure</SelectItem>
                    <SelectItem value="2">2 failures</SelectItem>
                    <SelectItem value="3">3 failures</SelectItem>
                    <SelectItem value="4">4 failures</SelectItem>
                    <SelectItem value="5">5 failures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="recovery-threshold"
                  className="text-sm font-medium"
                >
                  Recovery Threshold
                </Label>
                <p className="text-sm text-muted-foreground">
                  Alert after this many consecutive successes
                </p>
                <Select
                  value={(config.recoveryThreshold || 1).toString()}
                  onValueChange={(value) =>
                    updateConfig({ recoveryThreshold: parseInt(value) })
                  }
                >
                  <SelectTrigger id="recovery-threshold">
                    <SelectValue placeholder="Select threshold" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 success</SelectItem>
                    <SelectItem value="2">2 successes</SelectItem>
                    <SelectItem value="3">3 successes</SelectItem>
                    <SelectItem value="4">4 successes</SelectItem>
                    <SelectItem value="5">5 successes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notification Providers */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Notification Channels
                </Label>
                <Dialog
                  open={isProviderDialogOpen}
                  onOpenChange={setIsProviderDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!canCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Channel
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Add Notification Channel</DialogTitle>
                      <DialogDescription>
                        Configure a new notification channel for alerts
                      </DialogDescription>
                    </DialogHeader>
                    <NotificationProviderForm
                      onSuccess={async (newProvider) => {
                        try {
                          const response = await fetch(
                            "/api/notification-providers",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                type: newProvider.type,
                                config: newProvider.config,
                              }),
                            }
                          );

                          if (response.ok) {
                            const createdProvider = await response.json();
                            setProviders((prev) => [...prev, createdProvider]);
                            setIsProviderDialogOpen(false);
                          } else {
                            console.error(
                              "Failed to create notification provider"
                            );
                          }
                        } catch (error) {
                          console.error(
                            "Error creating notification provider:",
                            error
                          );
                        }
                      }}
                      onCancel={() => setIsProviderDialogOpen(false)}
                    />
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="h-16 bg-muted rounded-lg animate-pulse" />
                  <div className="h-16 bg-muted rounded-lg animate-pulse" />
                </div>
              ) : (
                <div>
                  {providers.length === 0 ? (
                    <div className="text-center py-6 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                      <div className="flex flex-col items-center space-y-3">
                        <Bell className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            No notification channels configured
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 mb-4 text-center">
                            Create a notification channel first to receive
                            alerts
                          </p>
                        </div>
                        {/* <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsProviderDialogOpen(true)}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create Channel
                        </Button> */}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {providers
                          .slice(
                            (currentPage - 1) * itemsPerPage,
                            currentPage * itemsPerPage
                          )
                          .map((provider) => {
                            const providerConfig =
                              getNotificationProviderConfig(provider.type);
                            const IconComponent = providerConfig.icon;
                            const isSelected = (
                              config.notificationProviders || []
                            ).includes(provider.id);

                            return (
                              <div
                                key={provider.id}
                                onClick={() => toggleProvider(provider.id)}
                                className={
                                  "flex items-center p-3 rounded-lg transition-all duration-200 cursor-pointer bg-secondary hover:shadow-sm hover:bg-muted/50"
                                }
                              >
                                <div className="flex items-center justify-center w-8 h-8 rounded-full mr-3 shrink-0 bg-muted/50">
                                  <IconComponent
                                    className={`h-4 w-4 ${providerConfig.color}`}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm truncate">
                                    {
                                      (
                                        provider.config as Record<
                                          string,
                                          unknown
                                        >
                                      ).name as string
                                    }
                                  </p>
                                  <p className="text-xs text-muted-foreground capitalize truncate">
                                    {provider.type}
                                  </p>
                                </div>
                                <Checkbox
                                  checked={isSelected}
                                  onChange={() => { }} // Handled by parent onClick
                                  className="ml-2 shrink-0 data-[state=checked]:bg-blue-500  :border-blue-500 data-[state=checked]:border-blue-500 data-[state=checked]:text-white"
                                  onClick={(e) => e.stopPropagation()} // Prevent double toggle
                                />
                              </div>
                            );
                          })}
                      </div>

                      {/* Pagination */}
                      {providers.length > itemsPerPage && (
                        <div className="flex items-center justify-center space-x-2 mt-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCurrentPage((prev) => Math.max(1, prev - 1))
                            }
                            disabled={currentPage === 1}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {currentPage} of{" "}
                            {Math.ceil(providers.length / itemsPerPage)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCurrentPage((prev) =>
                                Math.min(
                                  Math.ceil(providers.length / itemsPerPage),
                                  prev + 1
                                )
                              )
                            }
                            disabled={
                              currentPage ===
                              Math.ceil(providers.length / itemsPerPage)
                            }
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {validationErrors.notificationProviders && (
                <p className="text-sm text-destructive">
                  {validationErrors.notificationProviders}
                </p>
              )}

              {/* Channel count display */}
              {!validationErrors.notificationProviders && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {config.notificationProviders?.length || 0} of{" "}
                    {context === "job"
                      ? maxJobNotificationChannels
                      : maxMonitorNotificationChannels}{" "}
                    channels selected
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
