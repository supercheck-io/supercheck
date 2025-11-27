"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  Bell, 
  Shield, 
  Save, 
  Loader2,
  Mail,
  X,
  Check
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [success, setSuccess] = useState(false);

  // Form state
  const [enableLimit, setEnableLimit] = useState(false);
  const [limitAmount, setLimitAmount] = useState("");
  const [hardStop, setHardStop] = useState(false);
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
        setHardStop(settingsData.hardStopOnLimit);
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
      setSuccess(false);

      const response = await fetch("/api/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enableSpendingLimit: enableLimit,
          monthlySpendingLimitDollars: enableLimit && limitAmount ? parseFloat(limitAmount) : null,
          hardStopOnLimit: hardStop,
          notifyAt50Percent: false,
          notifyAt80Percent: enableNotifications,
          notifyAt90Percent: enableNotifications,
          notifyAt100Percent: enableNotifications,
          notificationEmails: emails,
        }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    if (newEmail && !emails.includes(newEmail) && newEmail.includes("@")) {
      setEmails([...emails, newEmail]);
      setNewEmail("");
    }
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
    <TooltipProvider>
      <div className={cn("space-y-4", className)}>
        {/* Spending Limit Row */}
        <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Spending Limit</p>
                <p className="text-xs text-muted-foreground">
                  Cap monthly overage charges beyond your included quota
                </p>
              </div>
              <Switch
                checked={enableLimit}
                onCheckedChange={setEnableLimit}
              />
            </div>
            
            {enableLimit && (
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
                <span className="text-xs text-muted-foreground">/month</span>
                
                <div className="ml-auto flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          id="hard-stop"
                          checked={hardStop}
                          onCheckedChange={setHardStop}
                          className="scale-90"
                        />
                        <Label htmlFor="hard-stop" className="text-xs font-normal flex items-center gap-1 cursor-pointer">
                          <Shield className="h-3.5 w-3.5" />
                          Hard stop
                        </Label>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px]">
                      <p className="text-xs">Block new executions when limit is reached. Scheduled jobs continue running.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            )}

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
        </div>

        {/* Notifications Row */}
        <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/30">
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
                      onKeyDown={(e) => e.key === "Enter" && addEmail()}
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

        {/* Save Button */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : success ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            {success ? "Saved" : "Save"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default SpendingLimits;
