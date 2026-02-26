"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { authClient } from "@/utils/auth-client";
import { PricingTierCard } from "@/components/billing/pricing-tier-card";
import { PricingComparisonTable } from "@/components/billing/pricing-comparison-table";
import { Shield, RefreshCw, AlertCircle } from "lucide-react";

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
    concurrentExecutions: string | number;
    queuedJobs: string | number;
    teamMembers: string | number;
    organizations: string | number;
    projects: string | number;
    statusPages: string | number;
    monitorDataRetention: string;
    jobDataRetention: string;
    customDomains?: boolean;
    ssoEnabled?: boolean;
    support?: string;
    checkInterval?: string;
    monitoringLocations?: string;
  };
  overagePricing: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
  };
}

interface FeatureRow {
  name: string;
  plus: string | boolean | number;
  pro: string | boolean | number;
  selfHosted?: string | boolean | number;
}

interface FeatureCategory {
  category: string;
  features: FeatureRow[];
}

interface OveragePricingData {
  plus: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
  };
  pro: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
  };
}

interface PricingData {
  plans: PricingPlan[];
  featureComparison: FeatureCategory[];
  faqs: Array<{ question: string; answer: string }>;
  overagePricing?: OveragePricingData;
}

const defaultFaqs = [
  {
    question: "How is usage tracked?",
    answer:
      "Playwright Minutes count total browser execution time. K6 VU Minutes are calculated as Virtual Users × execution time in minutes. Monitors count against Playwright minutes for each check.",
  },
  {
    question: "What happens if I exceed my limits?",
    answer:
      "For Playwright minutes and K6 VU minutes, usage-based overage billing automatically applies at the rates shown above. AI credits have a hard monthly limit — upgrade your plan for more. You'll receive email alerts at 80% and 100% of quota.",
  },
  {
    question: "Can I change plans?",
    answer:
      "Yes! Upgrades take effect immediately. Downgrades take effect at the next billing cycle. Pro-rated billing applies for mid-cycle changes.",
  },
  {
    question: "Do unused minutes roll over?",
    answer:
      "No, included minutes reset each billing cycle. However, you can always upgrade your plan if you consistently need more resources.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept all major credit cards (Visa, Mastercard, American Express) through our secure payment processor Polar.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "We don't offer a free trial, but you can start with our Plus plan and upgrade or downgrade at any time based on your needs.",
  },
  {
    question: "Can I cancel my subscription?",
    answer:
      "Yes, you can cancel anytime. Your subscription will remain active until the end of the current billing period.",
  },
  {
    question: "Do you offer enterprise plans?",
    answer:
      "Yes! Contact us for custom enterprise plans with dedicated support, custom SLAs, and volume discounts.",
  },
];

export default function SubscribePage() {
  return (
    <Suspense fallback={<SubscribeSkeleton />}>
      <SubscribePageContent />
    </Suspense>
  );
}

function SubscribePageContent() {
  const searchParams = useSearchParams();
  const isRequired = searchParams.get("required") === "true";
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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
    // NOTE: Organization setup is handled by SetupChecker in the layout
    // Do not call setup-defaults here to avoid race conditions
    fetchPricing();
  }, [fetchPricing]);

  const handleSubscribe = async (planSlug: string) => {
    // Prevent double-click: if already subscribing, ignore
    if (subscribing) return;
    
    setSubscribing(planSlug);
    try {
      // IMPORTANT: Ensure organization exists before checkout
      // In cloud mode, users may arrive at /subscribe without having an organization yet
      // (e.g., after email verification, the signup flow skips setup-defaults)
      try {
        await fetch("/api/auth/setup-defaults", { method: "POST" });
      } catch (setupError) {
        console.log("Setup defaults call completed (may already exist):", setupError);
      }

      // Get the user's organization ID to link the subscription
      const orgsResponse = await fetch("/api/organizations");
      const orgsResult = await orgsResponse.json();
      // API returns { success: true, data: [...] }
      const orgs = orgsResult.data || orgsResult;
      const organizationId = orgs?.[0]?.id;

      if (!organizationId) {
        console.error("No organization found in response:", orgsResult);
        throw new Error("No organization found. Please try refreshing the page.");
      }

      // Use Better Auth Polar checkout client method with referenceId
      await authClient.checkout({
        slug: planSlug,
        referenceId: organizationId, // Link subscription to organization
      });
    } catch (error) {
      console.error("Checkout error:", error);
      toast.error("Failed to start checkout. Please try again.");
      setSubscribing(null);
    }
  };

  if (loading) {
    return <SubscribeSkeleton />;
  }

  if (error || !pricingData) {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-semibold">Unable to load pricing</h2>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load the pricing information. Please check your connection and try again.
        </p>
        <Button variant="outline" onClick={fetchPricing}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const plans = pricingData.plans || [];
  const faqs = pricingData.faqs?.length ? pricingData.faqs : defaultFaqs;

  return (
    <div className="max-w-7xl mx-auto py-6 md:py-8 px-4 space-y-10 md:space-y-12">
      {/* Subscription Required Banner */}
      {isRequired && (
        <div className="max-w-2xl mx-auto bg-muted/50 border rounded-lg px-4 py-3 text-center text-sm text-muted-foreground">
          A subscription is required to access the dashboard. Choose a plan below to get started.
        </div>
      )}

      {/* Hero Section */}
      <section className="text-center space-y-3 pt-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Choose your plan
        </h1>
        <p className="text-base text-muted-foreground max-w-2xl mx-auto">
          Powerful monitoring and testing for your team. Upgrade or downgrade anytime.
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Secure payment via Polar
          </span>
          <span>·</span>
          <span>Cancel anytime</span>
          <span>·</span>
          <span>No hidden fees</span>
        </div>
      </section>

      {/* Pricing Tier Cards */}
      <section className="max-w-5xl mx-auto">
        <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <PricingTierCard
              key={plan.id}
              name={plan.name}
              price={plan.price}
              priceInterval={plan.interval}
              tagline={plan.description}
              badge={plan.id === "pro" ? "Most Popular" : undefined}
              keyFeatures={[
                `${Number(plan.features.monitors).toLocaleString()} uptime monitors`,
                `${Number(plan.features.playwrightMinutes).toLocaleString()} Playwright mins/mo`,
                `${Number(plan.features.k6VuMinutes).toLocaleString()} K6 VU-mins/mo`,
                `${Number(plan.features.aiCredits).toLocaleString()} AI credits/mo`,
                `${plan.features.teamMembers} team members`,
                `${plan.features.projects} projects`,
                `${plan.features.monitorDataRetention} monitor retention`,
                `${plan.features.jobDataRetention} job retention`,
                plan.features.customDomains
                  ? "Custom domains"
                  : "Standard domains",
              ]}
              overageText={`Overage: $${plan.overagePricing.playwrightMinutes}/min Playwright · $${plan.overagePricing.k6VuMinutes}/VU-min K6 · AI credits: hard limit`}
              ctaText={`Get Started with ${plan.name}`}
              ctaVariant={plan.id === "pro" ? "default" : "outline"}
              onCtaClick={() => handleSubscribe(plan.id)}
              loading={subscribing === plan.id}
              disabled={subscribing !== null && subscribing !== plan.id}
              highlighted={plan.id === "pro"}
            />
          ))}
        </div>

        {/* Self-hosted mention */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          Need unlimited usage?{" "}
          <a
            href="https://github.com/supercheck-io/supercheck"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-medium"
          >
            Self-host Supercheck for free
          </a>
        </p>
      </section>

      <Separator className="my-8" />

      {/* Feature Comparison Table */}
      <section className="max-w-7xl mx-auto">
        <div className="text-center space-y-1.5 mb-6">
          <h2 className="text-2xl font-bold">Full feature comparison</h2>
          <p className="text-sm text-muted-foreground">
            All the details you need to make the right choice
          </p>
        </div>
        {pricingData && (
          <PricingComparisonTable
            categories={pricingData.featureComparison}
            overagePricing={pricingData.overagePricing}
          />
        )}
      </section>

      <Separator className="my-8" />

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto">
        <div className="text-center space-y-1.5 mb-6">
          <h2 className="text-2xl font-bold">Frequently asked questions</h2>
          <p className="text-sm text-muted-foreground">
            Everything you need to know about pricing
          </p>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left text-sm font-medium py-4 hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground pb-4">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* Contact Sales CTA */}
      <section className="text-center space-y-3 max-w-xl mx-auto pb-4">
        <h3 className="text-lg font-semibold">
          Need a custom enterprise plan?
        </h3>
        <p className="text-sm text-muted-foreground">
          Contact us for volume discounts, custom SLAs, and dedicated support.
        </p>
        <Button size="default" asChild>
          <a href="mailto:hello@supercheck.io">Contact Sales</a>
        </Button>
      </section>
    </div>
  );
}

function SubscribeSkeleton() {
  return (
    <div className="max-w-7xl mx-auto py-6 md:py-8 px-4 space-y-10 md:space-y-12">
      {/* Hero Skeleton */}
      <div className="text-center space-y-2 pt-2">
        <Skeleton className="h-9 w-64 mx-auto" />
        <Skeleton className="h-5 w-96 mx-auto max-w-full" />
      </div>

      {/* Pricing Cards Skeleton */}
      <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6 border">
            {/* Plan name and tagline */}
            <Skeleton className="h-8 w-24 mb-1" />
            <Skeleton className="h-4 w-56 mb-4" />
            {/* Price */}
            <Skeleton className="h-14 w-36 mb-6" />
            {/* Features - 8 items to match actual card */}
            <div className="space-y-3 mb-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded-full flex-shrink-0" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
            {/* CTA Button */}
            <Skeleton className="h-11 w-full mb-4" />
            {/* Overage text */}
            <div className="pt-4 border-t">
              <Skeleton className="h-3 w-full mx-auto" />
            </div>
          </Card>
        ))}
      </div>

      {/* Self-hosted link skeleton */}
      <div className="text-center">
        <Skeleton className="h-4 w-72 mx-auto" />
      </div>

      <Skeleton className="h-px w-full" />

      {/* Table Skeleton */}
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="text-center space-y-1.5 mb-6">
          <Skeleton className="h-7 w-56 mx-auto" />
          <Skeleton className="h-4 w-72 mx-auto" />
        </div>
        <div className="rounded-lg border overflow-hidden">
          <Skeleton className="h-12 w-full" />
          {[1, 2, 3, 4, 5].map((cat) => (
            <div key={cat}>
              <Skeleton className="h-10 w-full bg-muted/40" />
              {[1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-11 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="h-px w-full" />

      {/* FAQ Skeleton */}
      <div className="space-y-4 max-w-3xl mx-auto">
        <div className="text-center space-y-1.5 mb-6">
          <Skeleton className="h-7 w-64 mx-auto" />
          <Skeleton className="h-4 w-80 mx-auto" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>

      {/* Contact Sales Skeleton */}
      <div className="text-center space-y-3 max-w-xl mx-auto pb-4">
        <Skeleton className="h-6 w-64 mx-auto" />
        <Skeleton className="h-4 w-80 mx-auto" />
        <Skeleton className="h-10 w-32 mx-auto" />
      </div>
    </div>
  );
}
