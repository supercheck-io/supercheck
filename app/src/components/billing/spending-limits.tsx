"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Bell, Save, Loader2, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SpendingLimitsProps {
  organizationId?: string;
  onSaveButton?: (button: React.ReactNode) => void;
  className?: string;
  onSaved?: () => void | Promise<void>;
}

interface BillingSettings {
  id: string;
  organizationId: string;
  monthlySpendingLimitCents: number | null;
  monthlySpendingLimitDollars: number | null;
  enableSpendingLimit: boolean;
  hardStopOnLimit: boolean;
  notifyAt50Percent: boolean;
  notifyAt80Percent: boolean;
  notifyAt90Percent: boolean;
  notifyAt100Percent: boolean;
  notificationEmails: string[];
}

interface SpendingStatus {
  currentDollars: number;
  limitDollars: number | null;
  limitEnabled: boolean;
  hardStopEnabled: boolean;
  percentageUsed: number;
  isAtLimit: boolean;
  remainingDollars: number | null;
}

export function SpendingLimits({ organizationId, className, onSaved }: SpendingLimitsProps) {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [spending, setSpending] = useState<SpendingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Form state
  const [enableLimit, setEnableLimit] = useState(false);
  const [limitAmount, setLimitAmount] = useState("");
  const [hardStop, setHardStop] = useState(true);
  const [thresholds, setThresholds] = useState([80, 90, 100]);
  const enableNotifications = thresholds.length > 0;
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  const parsedLimitAmount = limitAmount.trim() ? Number(limitAmount) : null;
  const limitAmountInvalid =
    enableLimit &&
    (parsedLimitAmount === null ||
      !Number.isFinite(parsedLimitAmount) ||
      parsedLimitAmount <= 0 ||
      parsedLimitAmount > 21474836.47 ||
      Math.abs(parsedLimitAmount * 100 - Math.round(parsedLimitAmount * 100)) > 0.000001);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [settingsRes, usageRes] = await Promise.all([
        fetch("/api/billing/settings"),
        fetch("/api/billing/usage"),
      ]);

      if (!settingsRes.ok) {
        throw new Error("Failed to load billing settings");
      }
      const settingsData: BillingSettings = await settingsRes.json();
      if (organizationId && settingsData.organizationId !== organizationId) {
        throw new Error("Selected organization changed");
      }
      setSettings(settingsData);
      setEnableLimit(settingsData.enableSpendingLimit);
      setLimitAmount(settingsData.monthlySpendingLimitDollars?.toString() || "");
      setHardStop(settingsData.hardStopOnLimit ?? true);
      setThresholds(([50, 80, 90, 100] as const).filter(
        (threshold) => settingsData[`notifyAt${threshold}Percent`],
      ));
      setEmails(settingsData.notificationEmails || []);

      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setSpending(usageData.organizationId === settingsData.organizationId ? usageData.spending : null);
      }
    } catch {
      // Never allow default form values to overwrite existing spending controls
      // when the server's settings could not be loaded.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (loading || loadError || saving || !settings) return;
    if (limitAmountInvalid) {
      toast.error("Spending limit is required", {
        description: "Enter a positive monthly overage cap before saving.",
        duration: 4000,
      });
      return;
    }

    try {
      setSaving(true);

      const response = await fetch("/api/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: settings.organizationId,
          enableSpendingLimit: enableLimit,
          monthlySpendingLimitDollars: enableLimit ? parsedLimitAmount : null,
          hardStopOnLimit: hardStop,
          notifyAt50Percent: thresholds.includes(50),
          notifyAt80Percent: thresholds.includes(80),
          notifyAt90Percent: thresholds.includes(90),
          notifyAt100Percent: thresholds.includes(100),
          notificationEmails: emails,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save billing settings");
      }

      const updatedSettings = await response.json();
      setSettings(updatedSettings);
      setSpending(null);
      // Saving succeeded even if the subsequent status refresh is unavailable.
      await Promise.allSettled([
        fetch("/api/billing/usage").then(async (result) => {
          if (result.ok) {
            const usageData = await result.json();
            setSpending(usageData.organizationId === settings.organizationId ? usageData.spending : null);
          }
        }),
        Promise.resolve().then(() => onSaved?.()),
      ]);

      toast.success("Billing settings saved successfully", {
        description:
          "Your spending limits and notification preferences have been updated.",
        duration: 4000,
      });
    } catch (error) {
      console.error("Error saving billing settings:", error);
      toast.error("Failed to save billing settings", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    if (!newEmail) {
      toast.error("Email is required", {
        description: "Please enter an email address",
        duration: 3000,
      });
      return;
    }

    if (emails.includes(newEmail)) {
      toast.error("Email already added", {
        description: "This email is already in the notification list",
        duration: 3000,
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      toast.error("Invalid email format", {
        description: "Please enter a valid email address",
        duration: 3000,
      });
      return;
    }

    setEmails([...emails, newEmail]);
    setNewEmail("");
    toast.success("Email added", {
      description: `${newEmail} will receive usage notifications`,
      duration: 3000,
    });
  };

  const removeEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email));
  };

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-6", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 pt-6" role="alert">
          <p className="text-sm">
            Billing controls could not be loaded. Retry before making changes.
          </p>
          <Button variant="outline" size="sm" onClick={fetchSettings}>
            Retry billing controls
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("", className)}>
      <CardContent className="space-y-4 pt-6">
        {/* Header with Save Button */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-medium">Billing Controls</p>
            <p className="text-sm text-muted-foreground">
              Control overage spending and get usage alerts
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || limitAmountInvalid}
            size="sm"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save
              </>
            )}
          </Button>
        </div>

        {/* Side by Side Controls */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Spending Limit Column */}
          <div className="flex flex-col h-full">
            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 flex-1">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">Spending Limit</p>
                    <p className="text-xs text-muted-foreground">
                      Set an overage budget for this billing period
                    </p>
                  </div>
                  <Switch
                    aria-label="Enable overage spending limit"
                    checked={enableLimit}
                    onCheckedChange={setEnableLimit}
                  />
                </div>

                {enableLimit && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 pt-1">
                      <div className="relative w-32">
                        <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          aria-label="Monthly overage limit in USD"
                          type="number"
                          min="0.01"
                          max="21474836.47"
                          step="0.01"
                          placeholder="100"
                          value={limitAmount}
                          onChange={(e) => setLimitAmount(e.target.value)}
                          aria-invalid={limitAmountInvalid}
                          className={cn(
                            "h-8 pl-7 text-sm",
                            limitAmountInvalid && "border-destructive",
                          )}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        USD per billing period
                      </span>
                    </div>
                    {limitAmountInvalid && (
                      <p className="text-xs text-destructive">
                        Enter a cap from $0.01 to $21,474,836.47 in whole cents.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Excludes your subscription fee and taxes. In-flight usage
                      can exceed this limit.
                    </p>

                    <label className="flex items-center justify-between gap-3 text-xs">
                      Stop new billable executions and full investigations at the limit
                      <Switch checked={hardStop} onCheckedChange={setHardStop}
                        aria-label="Stop execution at spending limit" />
                    </label>
                    {spending && spending.limitEnabled && (
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={
                            spending.isAtLimit
                              ? "text-destructive font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          Current: ${spending.currentDollars.toFixed(2)}
                        </span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">
                          {spending.remainingDollars !== null
                            ? `$${spending.remainingDollars.toFixed(2)} remaining`
                            : "No limit set"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Usage Alerts Column */}
          <div className="flex flex-col h-full">
            <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30 flex-1">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Bell className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">Usage Alerts</p>
                    <p className="text-xs text-muted-foreground">
                      Choose quota thresholds for email notifications
                    </p>
                  </div>
                  <Switch
                    aria-label="Enable usage notification emails"
                    checked={enableNotifications}
                    onCheckedChange={(enabled) => setThresholds(enabled ? [80, 90, 100] : [])}
                  />
                </div>

                {enableNotifications && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-3">
                      {[50, 80, 90, 100].map((threshold) => (
                        <label key={threshold} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={thresholds.includes(threshold)}
                            onChange={(event) => setThresholds((current) => event.target.checked
                              ? [...current, threshold] : current.filter((value) => value !== threshold))} />
                          {threshold}%
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          aria-label="Usage notification recipient email"
                          type="email"
                          placeholder="Add recipient email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addEmail();
                            }
                          }}
                          className="h-8 pl-8 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addEmail}
                        className="h-8"
                      >
                        Add
                      </Button>
                    </div>

                    {emails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {emails.map((email) => (
                          <Badge
                            key={email}
                            variant="secondary"
                            className="gap-1 text-xs py-0.5"
                          >
                            {email}
                            <button
                              aria-label={`Remove ${email}`}
                              type="button"
                              onClick={() => removeEmail(email)}
                              className="ml-0.5 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Org admins always receive alerts
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SpendingLimits;
