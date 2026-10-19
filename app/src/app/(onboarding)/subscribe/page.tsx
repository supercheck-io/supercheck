"use client";

import { useOrganizations } from "@/hooks/use-organizations";
import Link from "next/link";

import { formatOveragePrice } from "@/lib/billing/pricing-defaults";
import { useEffect, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PricingTierCard } from "@/components/billing/pricing-tier-card";
import {
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  CreditCard,
} from "lucide-react";

interface PricingPlan {
  id: string;
  name: string;
  price: number;
  interval: string;
  description: string;
  features: {
    monitors: string | number;
    playwrightMinutes: string | number;
    k6VuMinutes: string | number;
    aiCredits: string | number;
    sreInvestigationUnits: string | number;
    concurrentExecutions: string | number;
    queuedJobs: string | number;
    teamMembers: string | number;
    organizations: string | number;
    projects: string | number;
    statusPages: string | number;
    monitorDataRetention: string;
    jobDataRetention: string;
    customDomains?: boolean;
    support?: string;
    checkInterval?: string;
    monitoringLocations?: string;
  };
  overagePricing: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
    sreInvestigationUnits: number;
  };
}

interface PricingData {
  plans: PricingPlan[];
}

export default function SubscribePage() {
  const {
    activeOrganization,
    isPending: organizationLoading,
    isError: organizationError,
  } = useOrganizations();
  const overdue = activeOrganization?.subscriptionStatus === "past_due";
  const hasCurrentSubscription =
    activeOrganization?.subscriptionStatus === "active" ||
    activeOrganization?.subscriptionStatus === "past_due" ||
    (activeOrganization?.subscriptionStatus === "canceled" &&
      Boolean(
        activeOrganization.subscriptionEndsAt &&
          new Date(activeOrganization.subscriptionEndsAt).getTime() >
            Date.now(),
      ));
  const expired =
    !hasCurrentSubscription &&
    Boolean(
      activeOrganization?.subscriptionStatus === "canceled" ||
        activeOrganization?.subscriptionEndsAt,
    );
  const canSubscribe =
    activeOrganization?.role === "org_owner" &&
    !hasCurrentSubscription &&
    !organizationLoading &&
    !organizationError;
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const checkoutPending = useRef(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const fetchPricing = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch("/api/billing/pricing")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch pricing");
        return res.json();
      })
      .then((data) => setPricingData(data))
      .catch((err) => {
        console.error("Error fetching pricing:", err);
        setError(true);
        toast.error("Failed to load pricing information");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const handleSubscribe = async (planSlug: string) => {
    // Prevent double-click: if already subscribing, ignore
    if (checkoutPending.current || !canSubscribe) return;
    checkoutPending.current = true;
    setSubscribing(planSlug);
    try {
      // The server validates the active organization, owner role, product, and
      // redirect URLs before creating a Polar checkout.
      const checkoutRes = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          plan: planSlug,
          organizationId: activeOrganization?.id,
        }),
      });
      if (!checkoutRes.ok) {
        const errData = await checkoutRes.json().catch(() => ({}));
        throw new Error(
          errData?.error || errData?.message || "Checkout request failed",
        );
      }
      const checkoutData = await checkoutRes.json();
      if (checkoutData?.url) {
        window.location.href = checkoutData.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      toast.error("Unable to start checkout", {
        description:
          error instanceof Error
            ? error.message
            : "Please refresh and try again.",
      });
      checkoutPending.current = false;
      setSubscribing(null);
    }
  };

  if (loading && !hasCurrentSubscription) {
    return <SubscribeSkeleton />;
  }

  if ((error || !pricingData) && !hasCurrentSubscription) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
        <h1 className="text-xl font-semibold">Unable to load plans</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load the pricing information. Please check your
          connection and try again.
        </p>
        <Button variant="outline" onClick={fetchPricing}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const plans = pricingData?.plans || [];

  return (
    <div
      className={`mx-auto py-6 md:py-8 px-4 space-y-8 ${hasCurrentSubscription ? "max-w-2xl" : "max-w-4xl"}`}
    >
      <header className="space-y-3">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {overdue
            ? "Update your payment method"
            : expired
              ? "Restore your subscription"
              : hasCurrentSubscription
                ? "Your subscription"
                : "Choose your plan"}
        </h1>
        <p className="text-sm text-muted-foreground">
          One subscription covers all projects in your organization.
        </p>
      </header>

      <Card className="gap-5 p-5 sm:p-6 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold">
            {activeOrganization?.name || "Your organization"}
          </h2>
          {activeOrganization && (
            <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
              {overdue
                ? "Payment overdue"
                : expired
                  ? "Subscription ended"
                  : hasCurrentSubscription
                    ? activeOrganization.subscriptionStatus === "canceled"
                      ? "Cancellation scheduled"
                      : "Active"
                    : "Not subscribed"}
            </span>
          )}
        </div>
        {organizationLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Checking your organization before checkout...
          </p>
        )}
        {organizationError && (
          <p role="alert" className="text-sm text-destructive">
            Unable to load your organization. Refresh this page to retry.
          </p>
        )}
        {!organizationLoading && !organizationError && !activeOrganization && (
          <p className="text-sm text-muted-foreground">
            Your default organization is still being set up. Refresh this page
            to retry setup.
          </p>
        )}
        {activeOrganization && activeOrganization.role !== "org_owner" ? (
          <p className="text-sm text-muted-foreground">
            Only this organization&apos;s owner can subscribe. Contact the
            owner, or switch to an organization you own if available.
          </p>
        ) : hasCurrentSubscription ? (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {overdue
                ? "Your latest payment is overdue. Update your payment details to keep your existing subscription."
                : activeOrganization?.subscriptionStatus === "canceled"
                  ? "Your subscription will not renew. Access continues until the paid period ends."
                  : "View invoices, update payment details, or change your plan in billing."}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="text-sm font-medium">
                  {activeOrganization?.subscriptionPlan === "plus"
                    ? "Plus"
                    : activeOrganization?.subscriptionPlan === "pro"
                      ? "Pro"
                      : "Paid subscription"}
                </p>
              </div>
              {activeOrganization?.role === "org_owner" && (
                <Button
                  asChild
                  className="bg-[hsl(220,90%,56%)] text-white hover:bg-[hsl(220,90%,50%)] dark:bg-[hsl(220,90%,66%)] dark:text-slate-950 dark:hover:bg-[hsl(220,90%,72%)]"
                >
                  <Link href="/org-admin?tab=subscription">
                    <CreditCard aria-hidden="true" className="h-4 w-4" />
                    Manage subscription
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </>
        ) : (
          activeOrganization && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {expired
                ? "Your subscription has ended. Choose a plan below to restore access."
                : "Choose a plan below to activate your organization."}
            </p>
          )
        )}
      </Card>

      {/* Pricing Tier Cards */}
      {!hasCurrentSubscription && (
        <section className="max-w-4xl mx-auto">
          <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <PricingTierCard
                key={plan.id}
                name={plan.name}
                price={plan.price}
                priceInterval={plan.interval}
                tagline={plan.description}
                badge={plan.id === "pro" ? "Higher capacity" : undefined}
                keyFeatures={[
                  `${Number(plan.features.monitors).toLocaleString()} monitors`,
                  `${Number(plan.features.playwrightMinutes).toLocaleString()} Playwright minutes/month`,
                  `${Number(plan.features.k6VuMinutes).toLocaleString()} K6 VU-minutes/month`,
                  `${Number(plan.features.aiCredits).toLocaleString()} AI credits/month · fair use`,
                  `${Number(plan.features.sreInvestigationUnits).toLocaleString()} completed AI SRE reports/month`,
                  `${plan.features.teamMembers} team members · ${plan.features.projects} projects`,
                  `${plan.features.statusPages} status pages`,
                ]}
                overageText={`Overage: ${formatOveragePrice(plan.overagePricing.playwrightMinutes, "min", true)} Playwright · ${formatOveragePrice(plan.overagePricing.k6VuMinutes, "VU-min")} K6 · ${formatOveragePrice(plan.overagePricing.sreInvestigationUnits, "completed full AI SRE report")} · AI credits included, fair use`}
                ctaText={
                  expired
                    ? `Resubscribe to ${plan.name}`
                    : `Continue with ${plan.name}`
                }
                ctaVariant={plan.id === "pro" ? "default" : "outline"}
                onCtaClick={() => handleSubscribe(plan.id)}
                loading={subscribing === plan.id}
                disabled={
                  !canSubscribe ||
                  (subscribing !== null && subscribing !== plan.id)
                }
                highlighted={plan.id === "pro"}
              />
            ))}
          </div>
          <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            Billed monthly per organization in USD, before tax. Cancel anytime.
            <br />
            Usage overages are shown above. Review your total at checkout.
          </p>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <a
              href="https://supercheck.io/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 underline underline-offset-4"
            >
              Compare all features and pricing
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {" · "}
            <a
              href="mailto:hello@supercheck.io"
              className="underline underline-offset-4"
            >
              Contact us about Enterprise
            </a>
          </p>
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-4 text-xs text-muted-foreground">
        <a
          href="mailto:hello@supercheck.io"
          className="underline underline-offset-4"
        >
          Contact support
        </a>
        <a
          href="https://supercheck.io/terms"
          className="underline underline-offset-4"
        >
          Terms of service
        </a>
        <a
          href="https://supercheck.io/privacy"
          className="underline underline-offset-4"
        >
          Privacy policy
        </a>
      </footer>
    </div>
  );
}

function SubscribeSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading plans"
      className="max-w-4xl mx-auto p-4 space-y-6"
    >
      <Skeleton className="h-10 w-64 max-w-full mx-auto" />
      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6 space-y-4">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-14 w-36" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-11 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
