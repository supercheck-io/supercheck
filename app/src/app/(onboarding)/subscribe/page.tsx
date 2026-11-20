"use client";

import { useOrganizations } from "@/hooks/use-organizations";
import { hardNavigate } from "@/lib/auth/hard-navigate";
import { currentNextPath } from "@/lib/auth/safe-next-path";
import Link from "next/link";
import { useProjectContextSafe } from "@/hooks/use-project-context";
import { fetchProjectSetup } from "@/hooks/use-project-setup";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { formatOveragePrice } from "@/lib/billing/pricing-defaults";
import { ENTERPRISE_PLAN, PLAN_BASICS, planFeatureList } from "@/lib/billing/pricing-copy";
import catalog from "@/lib/billing/plan-catalog.json";
import { useEffect, useRef, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { TrialCard } from "@/components/billing/trial-card";
import { PricingTierCard } from "@/components/billing/pricing-tier-card";
import { PricingFaqs } from "@/components/billing/pricing-faqs";
import { trialFaqs } from "@/lib/billing/trial-copy";

import {
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  Check,
  CreditCard,
  Mail,
} from "lucide-react";


// Every trial FAQ except the last one ("What happens when the free trial ends?") offers the trial.
const TRIAL_OFFER_QUESTIONS = new Set(trialFaqs().slice(0, -1).map((faq) => faq.question));

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
    statusPageSubscribers?: string | number;
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
  faqs?: Array<{ question: string; answer: string }>;
  trial?: { durationDays: number; highlights: string[] };
}

/** A project nobody has set up yet opens its setup; any failure falls back to the dashboard. */
async function defaultDestination(projectId: string | null): Promise<string> {
  if (!projectId) return "/";
  try {
    const { state } = await fetchProjectSetup(projectId);
    return state.status === "not_started" ? "/setup" : "/";
  } catch {
    return "/";
  }
}

export default function SubscribePage() {
  const {
    activeOrganization,
    isPending: organizationLoading,
    isError: organizationError,
  } = useOrganizations();
  const activeProjectId = useProjectContextSafe()?.currentProject?.id ?? null;
  const queryClient = useQueryClient();
  const organizationId = activeOrganization?.id;
  const {
    data: access,
    isPending: accessLoading,
    isError: accessError,
    refetch: refreshAccess,
  } = useQuery<{
    organizationId: string;
    isActive: boolean;
    plan: "plus" | "pro" | "unlimited" | null;
    status: "active" | "past_due" | "canceled" | "none" | null;
    reason: string;
    subscriptionEndsAt?: string | null;
    trial?: {
      active: boolean;
      expiresAt: string;
      daysRemaining: number;
    } | null;
  }>({
    queryKey: ["subscription-status", organizationId],
    queryFn: async () => {
      const response = await fetch(
        `/api/subscription/status?organizationId=${encodeURIComponent(organizationId!)}`,
      );
      if (!response.ok) throw new Error("Unable to verify subscription access");
      const result = await response.json();
      if (result.organizationId !== organizationId)
        throw new Error("Organization changed. Refresh before subscribing.");
      return result;
    },
    enabled:
      Boolean(organizationId) && !organizationLoading && !organizationError,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });
  const hasCurrentSubscription = access?.isActive === true;
  // Match checkout's duplicate-purchase guard even when access validation fails.
  const billingNeedsAttention = Boolean(
    access &&
      !access.isActive &&
      (access.status === "active" ||
        access.status === "past_due" ||
        (access.status === "canceled" &&
          access.subscriptionEndsAt &&
          new Date(access.subscriptionEndsAt).getTime() > Date.now())),
  );
  const hasBillingContext = hasCurrentSubscription || billingNeedsAttention;
  const overdue = access?.status === "past_due";
  const trialActive = !hasBillingContext && access?.trial?.active === true;
  const trialEnded = !hasBillingContext && access?.trial?.active === false;
  const expired =
    !hasBillingContext &&
    !trialEnded &&
    Boolean(access?.status === "canceled" || access?.subscriptionEndsAt);
  const canSubscribe =
    activeOrganization?.role === "org_owner" &&
    Boolean(access) &&
    !hasBillingContext &&
    !accessLoading &&
    !accessError &&
    !organizationLoading &&
    !organizationError;
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const checkoutPending = useRef(false);
  const setupAttempted = useRef(false);
  // The setup request can fail (for example an unverified email); say so and let the user retry, instead
  // of leaving them on a message that promises an update that will not come.
  const [setupFailed, setSetupFailed] = useState(false);
  const [setupRun, setSetupRun] = useState(0);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const retrySetup = () => {
    setupAttempted.current = false;
    setSetupFailed(false);
    setSetupRun((run) => run + 1);
  };

  // Checkout leaves the page with a plain navigation. Pressing Back can restore this page from the
  // back/forward cache with its state intact, which would leave every plan button disabled until a reload.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      checkoutPending.current = false;
      setSubscribing(null);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

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

  // /subscribe is reachable without visiting the dashboard, where SetupChecker
  // normally creates a new user's organization. Recover that path here so a
  // direct visit cannot leave checkout permanently disabled.
  useEffect(() => {
    if (
      organizationLoading ||
      organizationError ||
      organizationId ||
      setupAttempted.current
    ) {
      return;
    }

    setupAttempted.current = true;

    const setupDefaults = async () => {
      try {
        const response = await fetch("/api/auth/setup-defaults", {
          method: "POST",
        });
        if (!response.ok) {
          setSetupFailed(true);
          return;
        }

        const result = (await response.json().catch(() => null)) as {
          pendingInvitationId?: string;
        } | null;

        if (result?.pendingInvitationId) {
          window.location.assign(
            new URL(
              `/invite/${encodeURIComponent(result.pendingInvitationId)}`,
              window.location.origin,
            ).toString(),
          );
          return;
        }

        await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      } catch (setupError) {
        console.warn("Setup defaults failed:", setupError);
        setSetupFailed(true);
      }
    };

    void setupDefaults();
  }, [organizationError, organizationId, organizationLoading, queryClient, setupRun]);

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
          // Where to go once the subscription is active; the server re-validates it.
          next: currentNextPath() ?? undefined,
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

  if (organizationId && accessLoading && !organizationError)
    return <SubscribeSkeleton />;
  if (organizationId && accessError)
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
        <h1 className="text-xl font-semibold">
          Unable to verify your subscription
        </h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t check your organization&apos;s billing status. Retry
          before starting checkout.
        </p>
        <Button variant="outline" onClick={() => refreshAccess()}>
          Retry
        </Button>
      </div>
    );

  if (loading && !hasBillingContext) {
    return <SubscribeSkeleton />;
  }

  if ((error || !pricingData) && !hasBillingContext) {
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
      className={`mx-auto py-6 md:py-8 px-4 space-y-8 ${hasBillingContext ? "max-w-2xl" : "max-w-6xl"}`}
    >
      <header className="space-y-3">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {billingNeedsAttention
            ? "Review your billing setup"
            : overdue
              ? "Update your payment method"
              : trialEnded
                ? "Your free trial has ended"
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
              {billingNeedsAttention
                ? "Billing needs attention"
                : overdue
                  ? "Payment overdue"
                  : trialEnded
                    ? "Trial ended"
                    : trialActive
                      ? `Free trial · ${access?.trial?.daysRemaining} days left`
                      : expired
                        ? "Subscription ended"
                        : hasCurrentSubscription
                          ? access?.status === "canceled"
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
        {!organizationLoading &&
          !organizationError &&
          !activeOrganization &&
          !setupFailed && (
            <p className="text-sm text-muted-foreground">
              Your default organization is still being set up. This page will
              update automatically; refresh if it does not.
            </p>
          )}
        {!organizationLoading &&
          !organizationError &&
          !activeOrganization &&
          setupFailed && (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-destructive">
                We couldn&apos;t finish setting up your default organization. If
                you haven&apos;t verified your email address yet, do that first,
                then try again.
              </p>
              <Button variant="outline" size="sm" onClick={retrySetup}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
            </div>
          )}
        {activeOrganization && activeOrganization.role !== "org_owner" ? (
          <p className="text-sm text-muted-foreground">
            Only this organization&apos;s owner can subscribe. Contact the
            owner, or switch to an organization you own if available.
          </p>
        ) : hasBillingContext ? (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {billingNeedsAttention
                ? "We couldn’t confirm access for this subscription. Review billing or contact support before starting another subscription."
                : overdue
                  ? "Your latest payment is overdue. Update your payment details to keep your existing subscription."
                  : access?.status === "canceled"
                    ? "Your subscription will not renew. Access continues until the paid period ends."
                    : "View invoices, update payment details, or change your plan in billing."}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {billingNeedsAttention ? "Access status" : "Current plan"}
                </p>
                <p className="text-sm font-medium">
                  {access?.plan === "plus"
                    ? "Plus"
                    : access?.plan === "pro"
                      ? "Pro"
                      : billingNeedsAttention
                        ? "Needs review"
                        : "Paid subscription"}
                </p>
              </div>
              {activeOrganization?.role === "org_owner" && (
                <Button asChild>
                  {billingNeedsAttention ? (
                    <a
                      href="mailto:hello@supercheck.io"
                      aria-label="Contact support about billing"
                    >
                      <Mail aria-hidden="true" className="h-4 w-4" />
                      Contact support
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </a>
                  ) : (
                    <Link href="/org-admin?tab=subscription">
                      <CreditCard aria-hidden="true" className="h-4 w-4" />
                      Manage subscription
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  )}
                </Button>
              )}
            </div>
          </>
        ) : (
          activeOrganization && (trialEnded || expired) && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {trialEnded
                ? "Your monitors are paused and your status pages are archived. Nothing was deleted: choose a plan below and they are restored."
                : "Your subscription has ended. Choose a plan below to restore access."}
            </p>
          )
        )}
        {trialActive && (
          <div className="border-t pt-4">
            <Button asChild variant="outline" size="sm">
              <Link
                href="/"
                onClick={async (event) => {
                  event.preventDefault();
                  hardNavigate(currentNextPath() ?? (await defaultDestination(activeProjectId)));
                }}
              >
                Continue with your trial
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </Card>

      {!hasBillingContext && (
        <section aria-label="Plans">
          <div className="grid overflow-hidden rounded-xl border lg:grid-cols-3">
            {plans.map((plan) => (
              <PricingTierCard
                key={plan.id}
                name={plan.name}
                price={plan.price}
                priceInterval={plan.interval}
                tagline={plan.description}
                badge={plan.id === "pro" ? "Popular" : undefined}
                features={planFeatureList(plan.id === "pro" ? "pro" : "plus", {
                  maxMonitors: Number(plan.features.monitors),
                  playwrightMinutesIncluded: Number(plan.features.playwrightMinutes),
                  k6VuMinutesIncluded: Number(plan.features.k6VuMinutes),
                  aiCreditsIncluded: Number(plan.features.aiCredits),
                  sreInvestigationUnitsIncluded: Number(plan.features.sreInvestigationUnits),
                  // The default cap a new subscription starts with; owners can change it later.
                  defaultSpendingLimitCents: catalog[plan.id === "pro" ? "pro" : "plus"].limits.defaultSpendingLimitCents,
                  runningCapacity: Number(plan.features.concurrentExecutions),
                  maxTeamMembers: Number(plan.features.teamMembers),
                  maxProjects: Number(plan.features.projects),
                  maxStatusPages: Number(plan.features.statusPages),
                  maxStatusPageSubscribers: Number(plan.features.statusPageSubscribers ?? 0),
                }, `${formatOveragePrice(plan.overagePricing.playwrightMinutes, "min", true)} Playwright, ${formatOveragePrice(plan.overagePricing.k6VuMinutes, "VU-min")} k6, ${formatOveragePrice(plan.overagePricing.sreInvestigationUnits, "investigation", true)} AI SRE`)}
                ctaText={
                  expired
                    ? `Resubscribe to ${plan.name}`
                    : `Continue with ${plan.name}`
                }
                onCtaClick={() => handleSubscribe(plan.id)}
                loading={subscribing === plan.id}
                disabled={
                  !canSubscribe ||
                  (subscribing !== null && subscribing !== plan.id)
                }
                highlighted={plan.id === "pro"}
              />
            ))}
            <PricingTierCard
              name={ENTERPRISE_PLAN.name}
              tagline={ENTERPRISE_PLAN.description}
              features={ENTERPRISE_PLAN.features}
              ctaText="Contact sales"
              ctaHref="mailto:hello@supercheck.io?subject=Supercheck%20Cloud%20Enterprise%20enquiry"
            />
          </div>
          <ul aria-label="Plan basics" className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {PLAN_BASICS.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Prices in USD, before tax. Review your total at checkout.{" "}
            <a
              href="https://supercheck.io/pricing#compare"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-4"
            >
              Compare all features and overage rates
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </section>
      )}

      {!hasBillingContext && pricingData?.trial && trialActive && (
        <TrialCard durationDays={pricingData.trial.durationDays} highlights={pricingData.trial.highlights} />
      )}

      {!hasBillingContext && pricingData?.faqs && pricingData.faqs.length > 0 && (
        <PricingFaqs
          faqs={
            // The trial is granted at organization setup, so the offer questions only apply while it runs;
            // an ended or ineligible organization keeps just "what happens when it ends".
            trialActive
              ? pricingData.faqs
              : pricingData.faqs.filter((faq) => !TRIAL_OFFER_QUESTIONS.has(faq.question))
          }
        />
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
      className="max-w-6xl mx-auto p-4 space-y-6"
    >
      <Skeleton className="h-10 w-64 max-w-full mx-auto" />
      <div className="grid gap-6 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
