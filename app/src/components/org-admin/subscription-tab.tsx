"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import {
  Calendar,
  Users,
  FolderOpen,
  ExternalLink,
  AlertCircle,
  Database,
  TrendingUp,
  Sparkles,
  Globe,
  Tally4,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { SpendingLimits } from "@/components/billing/spending-limits";
import { HardStopAlert } from "@/components/billing/hard-stop-alert";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

interface SubscriptionData {
  organizationId?: string;
  subscription: {
    plan: "plus" | "pro" | "unlimited" | null;
    status: "active" | "canceled" | "past_due" | "none";
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    subscriptionEndsAt?: string | null;
    hasBillingCustomer?: boolean;
    accessReason?: string;
    // Pricing info from API
    basePriceCents?: number | null;
    planName?: string | null;
  };
  usage: {
    playwrightMinutes: {
      used: number;
      included: number;
      overage: number;
      overageCostCents?: number;
      percentage: number;
    };
    k6VuMinutes: {
      used: number;
      included: number;
      overage: number;
      overageCostCents?: number;
      percentage: number;
    };
    aiCredits: {
      used: number;
      included: number;
      overage: number;
      overageCostCents?: number;
      percentage: number;
    };
    sreInvestigations: {
      used: number;
      included: number;
      overage: number;
      overageCostCents?: number;
      percentage: number;
    };
    totalOverageCostCents?: number;
  };
  limits: {
    monitors: {
      current: number;
      limit: number;
      remaining: number;
      percentage: number;
    };
    statusPages: {
      current: number;
      limit: number;
      remaining: number;
      percentage: number;
    };
    projects: {
      current: number;
      limit: number;
      remaining: number;
      percentage: number;
    };
    teamMembers: {
      current: number;
      limit: number;
      remaining: number;
      percentage: number;
    };
  };
  planFeatures: {
    customDomains: boolean;
    dataRetentionDays: number;
    aggregatedDataRetentionDays: number;
  };
}

interface UpgradePlan {
  id: string;
  price: number;
  features: { playwrightMinutes: number; k6VuMinutes: number; sreInvestigationUnits: number };
  overagePricing: { playwrightMinutes: number; k6VuMinutes: number; sreInvestigationUnits: number };
}

interface SpendingData {
  currentDollars: number;
  limitDollars: number | null;
  limitEnabled: boolean;
  hardStopEnabled: boolean;
  percentageUsed: number;
  isAtLimit: boolean;
  remainingDollars: number | null;
}

const planDetails: Record<string, { name: string; color: string }> = {
  plus: { name: "Plus", color: "bg-blue-500" },
  pro: { name: "Pro", color: "bg-purple-500" },
  unlimited: { name: "Unlimited", color: "bg-green-500" },
};

interface SubscriptionTabProps {
  /**
   * Current user's role in the organization.
   * Only org_owner can manage subscription (access Polar customer portal).
   * Polar customers belong to organizations; server routes enforce ownership.
   */
  currentUserRole?: string;
}

export function SubscriptionTab({ currentUserRole }: SubscriptionTabProps) {
  // Only org owners can manage subscription (access Polar customer portal)
  const canManageSubscription = currentUserRole === "org_owner";
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [proPlan, setProPlan] = useState<UpgradePlan | null>(null);
  const [spending, setSpending] = useState<SpendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const refreshGeneration = useRef(0);

  useEffect(() => {
    fetchSubscriptionData();
    return () => { refreshGeneration.current += 1; };
  }, []);

  const fetchSubscriptionData = async () => {
    const generation = ++refreshGeneration.current;
    try {
      // Optional plan comparison must not delay or fail billing details.
      void fetch("/api/billing/pricing")
        .then((response) => response.ok ? response.json() : null)
        .then((pricing) => {
          if (generation === refreshGeneration.current)
            setProPlan(pricing?.plans?.find((plan: UpgradePlan) => plan.id === "pro") ?? null);
        })
        .catch(() => {
          if (generation === refreshGeneration.current) setProPlan(null);
        });
      const [subscriptionRes, usageRes] = await Promise.all([
        fetch("/api/billing/current"),
        fetch("/api/billing/usage").catch(() => null),
      ]);

      if (!subscriptionRes.ok) {
        const errorData = await subscriptionRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Unable to fetch subscription information");
      }
      const [result, usageData] = await Promise.all([
        subscriptionRes.json(),
        usageRes?.ok ? usageRes.json().catch(() => null) : null,
      ]);
      if (generation !== refreshGeneration.current) return;
      setData(result);
      setSpending(usageData?.spending ?? null);
    } catch (error) {
      if (generation !== refreshGeneration.current) return;
      setData(null);
      setSpending(null);
      console.error("Error fetching subscription data:", error);
      toast.error("Failed to load subscription data", {
        description:
          error instanceof Error ? error.message : "Network error occurred",
        duration: 5000,
      });
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setOpeningPortal(true);
    try {
      const portalRes = await fetch("/api/billing/portal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: data?.organizationId }),
      });
      if (!portalRes.ok) {
        const errorData = await portalRes.json().catch(() => ({}));
        throw new Error(
          errorData?.error ||
            errorData?.message ||
            "Failed to fetch portal URL",
        );
      }
      const portalData = await portalRes.json();
      if (portalData?.url) {
        toast.success("Opening Polar customer portal...", {
          description: "You'll be redirected to manage your subscription.",
          duration: 3000,
        });
        window.location.href = portalData.url;
      } else {
        toast.error("Failed to open subscription portal", {
          description: "No portal URL returned. Please try again.",
          duration: 5000,
        });
      }
    } catch (error) {
      console.error("Error opening portal:", error);
      toast.error("Failed to open subscription portal", {
        description:
          error instanceof Error
            ? error.message
            : "Unable to connect to Polar. Please try again.",
        duration: 5000,
      });
    } finally {
      setOpeningPortal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <SupercheckLoading size="md" message="Loading subscription..." />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-2">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Unable to load subscription data
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchSubscriptionData();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const hasSubscription = data.subscription.plan !== null;
  const plan = data.subscription.plan
    ? planDetails[data.subscription.plan]
    : null;
  const periodEnd = data.subscription.currentPeriodEnd
    ? new Date(data.subscription.currentPeriodEnd)
    : null;
  const daysRemaining = periodEnd && Number.isFinite(periodEnd.getTime())
    ? Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Check if hard stop is active
  const isHardStopActive = spending?.hardStopEnabled && spending?.isAtLimit;

  // Calculate current period estimate using API-provided pricing
  // basePriceCents comes from API: Plus = 4900 ($49), Pro = 14900 ($149)
  const basePrice = (data.subscription.basePriceCents ?? 0) / 100;
  const currentOverage = spending?.currentDollars;
  const estimatedTotal =
    currentOverage === undefined ? null : basePrice + currentOverage;

  const proEstimate = proPlan && data.subscription.plan === "plus"
    ? proPlan.price
      + Math.max(0, data.usage.playwrightMinutes.used - proPlan.features.playwrightMinutes) * proPlan.overagePricing.playwrightMinutes
      + Math.ceil(Math.max(0, data.usage.k6VuMinutes.used - proPlan.features.k6VuMinutes) * proPlan.overagePricing.k6VuMinutes * 100) / 100
      + Math.ceil(Math.max(0, data.usage.sreInvestigations.used - proPlan.features.sreInvestigationUnits) * proPlan.overagePricing.sreInvestigationUnits * 100) / 100
    : null;
  const proSavings = estimatedTotal !== null && proEstimate !== null && Number.isFinite(proEstimate)
    ? estimatedTotal - proEstimate : 0;

  return (
    <div className="space-y-4">
      {/* Plan Header - Compact */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-2xl font-semibold">
                {plan ? `${plan.name} Plan` : "No active plan"}
              </h3>
              <Badge
                className={`${plan ? `${plan.color} text-white` : "bg-muted text-muted-foreground"} text-sm`}
              >
                {data.subscription.status === "past_due" ? "Payment overdue"
                  : data.subscription.status === "canceled" && hasSubscription ? "Cancellation scheduled"
                  : data.subscription.status === "none" ? "Not subscribed"
                  : data.subscription.status}
              </Badge>
              {/* Hard Stop Alert - Inline with status */}
              {isHardStopActive && spending && (
                <HardStopAlert
                  isActive={true}
                  currentSpending={spending.currentDollars}
                  limit={spending.limitDollars || 0}
                />
              )}
            </div>
            {hasSubscription && (
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mt-2">
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {daysRemaining === null ? "Billing period unavailable" : `${daysRemaining} days remaining`}
                </span>
                <span>•</span>
                <span
                  className="flex items-center gap-2"
                  title="Raw check results retention"
                >
                  <Database className="h-4 w-4" />
                  {data.planFeatures.dataRetentionDays}d raw
                </span>
                <span>•</span>
                <span
                  className="flex items-center gap-2"
                  title="Aggregated metrics retention (P95, avg, uptime)"
                >
                  <TrendingUp className="h-4 w-4" />
                  {data.planFeatures.aggregatedDataRetentionDays >= 365
                    ? `${Math.round(data.planFeatures.aggregatedDataRetentionDays / 365)}yr`
                    : `${data.planFeatures.aggregatedDataRetentionDays}d`}{" "}
                  metrics
                </span>
              </div>
            )}
          </div>
        </div>
        {data.subscription.plan !== "unlimited" && (
          <div className="flex flex-wrap items-center gap-4">
            {/* Current Period Estimate - Minimal display */}
            {hasSubscription && <div className="text-right">
              <p className="text-xs text-muted-foreground">
                Estimate at list prices · USD, before tax
              </p>
              <p className="text-lg font-semibold">
                {estimatedTotal === null
                  ? "Usage estimate unavailable"
                  : `$${estimatedTotal.toFixed(2)}`}
                {currentOverage !== undefined && currentOverage > 0 && (
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    (${basePrice} + ${currentOverage.toFixed(2)} overage)
                  </span>
                )}
              </p>
            </div>}
            {/* Only organization owners can open the organization's billing portal. */}
            {canManageSubscription && data.subscription.hasBillingCustomer && (
              <Button
                variant="outline"
                onClick={handleManageSubscription}
                disabled={openingPortal}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                {openingPortal ? "Opening..." : "Manage Subscription"}
                <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </Button>
            )}
          </div>
        )}
        {!hasSubscription && canManageSubscription && (
          <Button asChild>
            <Link href="/subscribe">Choose a plan</Link>
          </Button>
        )}
      </div>

      {hasSubscription && data.subscription.plan !== "unlimited" && (
        <p className="text-xs text-muted-foreground">
          This monthly subscription and its usage allowances cover this organization only.
          K6 usage is peak VUs × execution minutes, rounded up per run. AI credits are a hard limit.
          Discounts, credits, and plan-change proration can change your invoice.
          View invoices and payment details in Manage Subscription.
        </p>
      )}
      {proSavings >= 0.01 && (
        <p className="text-sm text-muted-foreground">
          At current list prices, Pro would cost about ${proEstimate?.toFixed(2)} for this usage,
          approximately ${proSavings.toFixed(2)} less. <Link href="/subscribe" className="underline">Compare plans</Link>.
          Review allowances, discounts, and proration before changing your subscription.
        </p>
      )}
      {data.subscription.status === "past_due" && (
        <p role="alert" className="text-sm text-destructive">
          Payment is overdue. The organization owner can update the payment method in Manage Subscription.
        </p>
      )}
      {data.subscription.status === "canceled" && hasSubscription && (
        <p className="text-sm text-muted-foreground">
          Your subscription will not renew. Access continues until the current period ends.
          The organization owner can reverse the cancellation in Manage Subscription.
        </p>
      )}

      {!hasSubscription && (
        <p className="text-sm text-muted-foreground">
          Choose a plan to view paid usage and resource allowances.
        </p>
      )}

      {/* Usage & Resources - Combined Compact Grid */}
      {hasSubscription && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Usage This Period */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">
                Usage This Period
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-muted-foreground">
              <UsageProgressBar
                icon={
                  <PlaywrightLogo
                    width={20}
                    height={20}
                    className="text-[#E2574C]"
                  />
                }
                label="Playwright Execution Minutes"
                used={data.usage.playwrightMinutes.used}
                included={data.usage.playwrightMinutes.included}
                overage={data.usage.playwrightMinutes.overage}
                percentage={data.usage.playwrightMinutes.percentage}
              />
              <UsageProgressBar
                icon={
                  <K6Logo width={18} height={18} className="text-[#7d64ff]" />
                }
                label="K6 Virtual User Minutes"
                used={data.usage.k6VuMinutes.used}
                included={data.usage.k6VuMinutes.included}
                overage={data.usage.k6VuMinutes.overage}
                percentage={data.usage.k6VuMinutes.percentage}
              />
              <UsageProgressBar
                icon={<Sparkles className="h-5 w-5 text-amber-500" />}
                label="AI Credits"
                used={data.usage.aiCredits.used}
                included={data.usage.aiCredits.included}
                overage={data.usage.aiCredits.overage}
                percentage={data.usage.aiCredits.percentage}
              />
              <UsageProgressBar
                icon={<AlertCircle className="h-5 w-5 text-cyan-500" />}
                label="SRE Investigations"
                used={data.usage.sreInvestigations.used}
                included={data.usage.sreInvestigations.included}
                overage={data.usage.sreInvestigations.overage}
                percentage={data.usage.sreInvestigations.percentage}
              />
            </CardContent>
          </Card>

          {/* Resource Limits - Compact */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">
                Resource Limits
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <CompactResourceCard
                  icon={Globe}
                  label="Monitors"
                  current={data.limits.monitors.current}
                  limit={data.limits.monitors.limit}
                />
                <CompactResourceCard
                  icon={Tally4}
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
      )}

      {/* Billing Controls - Only for cloud plans */}
      {hasSubscription && data.subscription.plan !== "unlimited" && (
          <SpendingLimits onSaved={fetchSubscriptionData} />
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        <div className="flex items-center gap-2">
          {hasOverage && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0 h-5">
              <TrendingUp className="h-3 w-3 mr-1" />+{overage.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
              overage
            </Badge>
          )}
          <span
            className={`text-sm ${hasOverage ? "text-red-500 font-medium" : "text-muted-foreground"}`}
          >
            {used.toLocaleString(undefined, { maximumFractionDigits: 4 })} / {included.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Custom progress bar with overage visualization */}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalizedPercentage}
        aria-valuetext={`${used} used of ${included} included`}
        className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20"
      >
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
                width: `${100 - includedPortion}%`,
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
      <Icon
        className={`h-4 w-4 shrink-0 ${isAtLimit ? "text-red-500" : isNearLimit ? "text-amber-500" : "text-muted-foreground"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-medium">
          {current}
          <span className="text-xs font-normal text-muted-foreground">
            /{limit >= 999999 ? "∞" : limit}
          </span>
        </p>
      </div>
    </div>
  );
}
