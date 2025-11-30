"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  DollarSign, 
  Bell, 
  Save, 
  Loader2,
  Mail,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SpendingLimitsProps {
  onSaveButton?: (button: React.ReactNode) => void;
  className?: string;
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

export function SpendingLimits({ className }: SpendingLimitsProps) {
  const [, setSettings] = useState<BillingSettings | null>(null);
  const [spending, setSpending] = useState<SpendingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [enableLimit, setEnableLimit] = useState(false);
  const [limitAmount, setLimitAmount] = useState("");
  const [enableNotifications, setEnableNotifications] = useState(true);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const [settingsRes, usageRes] = await Promise.all([
        fetch("/api/billing/settings"),
        fetch("/api/billing/usage"),
      ]);

      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setSettings(settingsData);
        setEnableLimit(settingsData.enableSpendingLimit);
        setLimitAmount(settingsData.monthlySpendingLimitDollars?.toString() || "");
        setEnableNotifications(settingsData.notifyAt80Percent || settingsData.notifyAt90Percent || settingsData.notifyAt100Percent);
        setEmails(settingsData.notificationEmails || []);
      }

      if (usageRes.ok) {
        const usageData = await usageRes.json();
        setSpending(usageData.spending);
      }
    } catch {
      // Silent fail - settings will use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const response = await fetch("/api/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enableSpendingLimit: enableLimit,
          monthlySpendingLimitDollars: enableLimit && limitAmount ? parseFloat(limitAmount) : null,
          hardStopOnLimit: enableLimit, // Hard stop is always enabled when spending limit is set
          notifyAt50Percent: false,
          notifyAt80Percent: enableNotifications,
          notifyAt90Percent: enableNotifications,
          notifyAt100Percent: enableNotifications,
          notificationEmails: emails,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save billing settings");
      }

      const updatedSettings = await response.json();
      setSettings(updatedSettings);
      
      toast.success("Billing settings saved successfully", {
        description: "Your spending limits and notification preferences have been updated.",
        duration: 4000,
      });
    } catch (error) {
      console.error("Error saving billing settings:", error);
      toast.error("Failed to save billing settings", {
        description: error instanceof Error ? error.message : "An unexpected error occurred",
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
            <Button onClick={handleSave} disabled={saving} size="sm">
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
                        Block executions when overage limit is reached
                      </p>
                    </div>
                    <Switch
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
                            type="number"
                            min="0"
                            step="1"
                            placeholder="100"
                            value={limitAmount}
                            onChange={(e) => setLimitAmount(e.target.value)}
                            className="h-8 pl-7 text-sm"
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">/month overage cap</span>
                      </div>

                      {spending && spending.limitEnabled && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className={spending.isAtLimit ? "text-destructive font-medium" : "text-muted-foreground"}>
                            Current: ${spending.currentDollars.toFixed(2)}
                          </span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">
                            {spending.remainingDollars !== null 
                              ? `$${spending.remainingDollars.toFixed(2)} remaining`
                              : "No limit set"
                            }
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
                        Email notifications at 80%, 90%, and 100% of quota
                      </p>
                    </div>
                    <Switch
                      checked={enableNotifications}
                      onCheckedChange={setEnableNotifications}
                    />
                  </div>

                  {enableNotifications && (
                    <div className="space-y-2 pt-1">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
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
                        <Button type="button" variant="outline" size="sm" onClick={addEmail} className="h-8">
                          Add
                        </Button>
                      </div>
                      
                      {emails.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {emails.map((email) => (
                            <Badge key={email} variant="secondary" className="gap-1 text-xs py-0.5">
                              {email}
                              <button
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
