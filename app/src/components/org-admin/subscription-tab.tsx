"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Calendar, 
  Users, 
  FolderOpen, 
  Monitor,
  FileText,
  ExternalLink,
  AlertCircle,
  Database,
  DollarSign,
  TrendingUp
} from "lucide-react";
import { authClient } from "@/utils/auth-client";
import { toast } from "sonner";
import { SpendingLimits } from "@/components/billing/spending-limits";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

interface SubscriptionData {
  subscription: {
    plan: "plus" | "pro" | "unlimited";
    status: "active" | "canceled" | "past_due" | "none";
    subscriptionId?: string;
    polarCustomerId?: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  usage: {
    playwrightMinutes: { used: number; included: number; overage: number; percentage: number };
    k6VuMinutes: { used: number; included: number; overage: number; percentage: number };
  };
  limits: {
    monitors: { current: number; limit: number; remaining: number; percentage: number };
    statusPages: { current: number; limit: number; remaining: number; percentage: number };
    projects: { current: number; limit: number; remaining: number; percentage: number };
    teamMembers: { current: number; limit: number; remaining: number; percentage: number };
  };
  planFeatures: {
    customDomains: boolean;
    ssoEnabled: boolean;
    dataRetentionDays: number;
  };
}

const planDetails: Record<string, { name: string; color: string }> = {
  plus: { name: "Plus", color: "bg-blue-500" },
  pro: { name: "Pro", color: "bg-purple-500" },
  unlimited: { name: "Unlimited", color: "bg-green-500" },
};

export function SubscriptionTab() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    fetchSubscriptionData();
  }, []);

  const fetchSubscriptionData = async () => {
    try {
      const response = await fetch("/api/billing/current");
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error("Error fetching subscription data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (authClient as any).customer.portal();
      if (result?.data?.url) {
        window.location.href = result.data.url;
      }
    } catch (error) {
      console.error("Error opening portal:", error);
      toast.error("Failed to open subscription portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  if (loading) {
    return <SubscriptionTabSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-2">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Unable to load subscription data</p>
          <Button variant="outline" size="sm" onClick={fetchSubscriptionData}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const plan = planDetails[data.subscription.plan] || planDetails.plus;
  const periodEnd = new Date(data.subscription.currentPeriodEnd);
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="space-y-4">
      {/* Plan Header - Compact */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-2xl font-semibold">{plan.name} Plan</h3>
              <Badge className={`${plan.color} text-white text-sm`}>
                {data.subscription.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {daysRemaining} days remaining
              </span>
              <span>•</span>
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                {data.planFeatures.dataRetentionDays} days retention
              </span>
            </div>
          </div>
        </div>
        {data.subscription.plan !== "unlimited" && (
          <Button 
            variant="outline"
            onClick={handleManageSubscription}
            disabled={openingPortal}
          >
            <DollarSign className="h-4 w-4 mr-2" />
            {openingPortal ? "Opening..." : "Manage Subscription"}
            <ExternalLink className="h-3.5 w-3.5 ml-2" />
          </Button>
        )}
      </div>

      {/* Usage & Resources - Combined Compact Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Usage This Period */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Usage This Period</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <UsageProgressBar
              icon={<PlaywrightLogo width={20} height={20} className="text-[#E2574C]" />}
              label="Playwright Execution Minutes"
              used={data.usage.playwrightMinutes.used}
              included={data.usage.playwrightMinutes.included}
              overage={data.usage.playwrightMinutes.overage}
              percentage={data.usage.playwrightMinutes.percentage}
            />
            <UsageProgressBar
              icon={<K6Logo width={18} height={18} className="text-[#7d64ff]" />}
              label="K6 Virtual User Minutes"
              used={data.usage.k6VuMinutes.used}
              included={data.usage.k6VuMinutes.included}
              overage={data.usage.k6VuMinutes.overage}
              percentage={data.usage.k6VuMinutes.percentage}
            />
          </CardContent>
        </Card>

        {/* Resource Limits - Compact */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Resource Limits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <CompactResourceCard
                icon={Monitor}
                label="Monitors"
                current={data.limits.monitors.current}
                limit={data.limits.monitors.limit}
              />
              <CompactResourceCard
                icon={FileText}
                label="Status Pages"
                current={data.limits.statusPages.current}
                limit={data.limits.statusPages.limit}
              />
              <CompactResourceCard
                icon={FolderOpen}
                label="Projects"
                current={data.limits.projects.current}
                limit={data.limits.projects.limit}
              />
              <CompactResourceCard
                icon={Users}
                label="Team Members"
                current={data.limits.teamMembers.current}
                limit={data.limits.teamMembers.limit}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Billing Controls - Only for cloud plans */}
      {data.subscription.plan !== "unlimited" && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-medium">Billing Controls</CardTitle>
                <CardDescription className="text-sm">
                  Control overage spending and get usage alerts
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <SpendingLimits />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Usage progress bar with overage visualization
 * - Shows included usage in blue
 * - Shows overage in red with proper bar scaling
 */
function UsageProgressBar({
  icon,
  label,
  used,
  included,
  overage,
  percentage,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  included: number;
  overage: number;
  percentage: number;
}) {
  const hasOverage = overage > 0;
  
  // For overage: scale so 100% of bar = total used, with included portion marked
  // For normal: scale so 100% of bar = included amount
  const normalizedPercentage = hasOverage
    ? 100 // Full bar represents total usage
    : Math.min(percentage, 100);
  
  // Calculate the portion of the bar that represents included usage
  const includedPortion = hasOverage
    ? (included / used) * 100
    : normalizedPercentage;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        <div className="flex items-center gap-2">
          {hasOverage && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0 h-5">
              <TrendingUp className="h-3 w-3 mr-1" />
              +{overage.toLocaleString()} overage
            </Badge>
          )}
          <span className={`text-sm ${hasOverage ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
            {used.toLocaleString()} / {included.toLocaleString()}
          </span>
        </div>
      </div>
      
      {/* Custom progress bar with overage visualization */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
        {hasOverage ? (
          <>
            {/* Included portion (blue) */}
            <div
              className="absolute h-full bg-primary transition-all duration-300 ease-in-out rounded-l-full"
              style={{ width: `${includedPortion}%` }}
            />
            {/* Overage portion (red) */}
            <div
              className="absolute h-full bg-red-500 transition-all duration-300 ease-in-out rounded-r-full"
              style={{ 
                left: `${includedPortion}%`, 
                width: `${100 - includedPortion}%` 
              }}
            />
            {/* Marker line at the included threshold */}
            <div 
              className="absolute h-full w-0.5 bg-white/80 z-10"
              style={{ left: `${includedPortion}%` }}
            />
          </>
        ) : (
          /* Normal usage - single blue bar */
          <div
            className="h-full bg-primary transition-all duration-300 ease-in-out"
            style={{ width: `${normalizedPercentage}%` }}
          />
        )}
      </div>
    </div>
  );
}

function CompactResourceCard({ 
  icon: Icon, 
  label, 
  current, 
  limit, 
}: { 
  icon: React.ElementType; 
  label: string; 
  current: number; 
  limit: number; 
}) {
  const percentage = limit > 0 ? (current / limit) * 100 : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
      <Icon className={`h-4 w-4 shrink-0 ${isAtLimit ? 'text-red-500' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-medium">
          {current}
          <span className="text-xs font-normal text-muted-foreground">
            /{limit >= 999999 ? '∞' : limit}
          </span>
        </p>
      </div>
    </div>
  );
}

function SubscriptionTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
