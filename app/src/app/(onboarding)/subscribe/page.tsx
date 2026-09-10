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
import { toast } from "sonner";
import { PricingTierCard } from "@/components/billing/pricing-tier-card";
import { PricingComparisonTable } from "@/components/billing/pricing-comparison-table";
import {
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  Mail,
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
    ssoEnabled?: boolean;
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

interface FeatureRow {
  name: string;
  plus: string | boolean | number;
  pro: string | boolean | number;
  enterprise?: string | boolean | number;
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
    sreInvestigationUnits: number;
  };
  pro: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
    sreInvestigationUnits: number;
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
      "Playwright minutes count browser execution time, including synthetic monitors, rounded to four decimal places per run with no whole-minute minimum. A five-second check uses 0.0833 minutes; each location and executed retry contributes usage. HTTP, ping, and port checks do not consume Playwright minutes. K6 VU minutes are peak virtual users × execution time in minutes, rounded up per run. Each completed full AI SRE investigation report consumes one investigation unit; completion does not guarantee a correct diagnosis or resolution. Failed runs and billing retries are not charged; chat, triage, and evidence briefs do not.",
  },
  {
    question: "What happens if I exceed my limits?",
    answer:
      "Playwright, K6, and successful full AI SRE investigations use the overage rates shown above. AI credits have a hard monthly limit. Configured billing contacts receive threshold alerts.",
  },
  {
    question: "Can I change plans?",
    answer:
      "The organization owner can change plans in Manage subscription. Review the effective date and any prorated charges in the Polar portal before confirming.",
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
      "Try our free demo at demo.supercheck.dev — no signup required. When you're ready, choose a plan to get started.",
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
        console.log(
          "Setup defaults call completed (may already exist):",
          setupError,
        );
      }

      // The server validates the active organization, owner role, product, and
      // redirect URLs before creating a Polar checkout.
      const checkoutRes = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: planSlug }),
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

  const plans = pricingData.plans || [];
  const faqs = pricingData.faqs?.length ? pricingData.faqs : defaultFaqs;

  return (
    <div className="max-w-7xl mx-auto py-6 md:py-8 px-4 space-y-10 md:space-y-12">
      {/* Subscription Required Banner */}
      {isRequired && (
        <div className="max-w-2xl mx-auto bg-muted/50 border rounded-lg px-4 py-3 text-center text-sm text-muted-foreground">
          A subscription is required to access the dashboard. Choose a plan
          below to get started.
        </div>
      )}

      {/* Hero Section */}
      <section className="text-center space-y-4 pt-4">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
          Simple, transparent pricing
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Open-Source Testing, Monitoring, and Reliability — as Code
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
          <span>Cancel anytime</span>
          <span className="hidden sm:inline">·</span>
          <span>Prices in USD, before applicable tax</span>
          <span className="hidden sm:inline">·</span>
          <span>Usage-based overage</span>
        </div>
      </section>

      {/* Pricing Tier Cards */}
      <section className="max-w-6xl mx-auto">
        <div className="grid gap-6 lg:grid-cols-3 md:grid-cols-2 max-w-6xl mx-auto">
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
                `${Number(plan.features.sreInvestigationUnits).toLocaleString()} AI SRE investigations/mo`,
                `${plan.features.teamMembers} team members`,
                `${plan.features.projects} projects`,
                `${plan.features.monitorDataRetention} monitor retention`,
                `${plan.features.jobDataRetention} job retention`,
                plan.features.customDomains
                  ? "Custom domains"
                  : "Standard domains",
              ]}
              overageText={`Overage: $${plan.overagePricing.playwrightMinutes}/min Playwright · $${plan.overagePricing.k6VuMinutes}/VU-min K6 · $${plan.overagePricing.sreInvestigationUnits}/AI SRE investigation · AI credits: hard limit`}
              ctaText={`Get Started with ${plan.name}`}
              ctaVariant={plan.id === "pro" ? "default" : "outline"}
              onCtaClick={() => handleSubscribe(plan.id)}
              loading={subscribing === plan.id}
              disabled={subscribing !== null && subscribing !== plan.id}
              highlighted={plan.id === "pro"}
            />
          ))}

          {/* Enterprise Card */}
          <PricingTierCard
            name="Enterprise"
            price="Custom"
            tagline="For large organizations with custom requirements"
            badge="Tailored"
            keyFeatures={[
              "Unlimited uptime monitors",
              "Custom Playwright & K6 allowances",
              "Unlimited AI credits",
              "Custom AI SRE investigation volume",
              "Unlimited team members & projects",
              "Custom data retention policies",
              "Dedicated account manager",
              "Custom SLA & priority support",
              "SSO/SAML & advanced security",
              "Onboarding & training",
            ]}
            ctaText="Contact Sales"
            ctaVariant="outline"
            ctaHref="mailto:hello@supercheck.io"
          />
        </div>

        {/* Self-hosted & demo links */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8 text-sm">
          <a
            href="https://demo.supercheck.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Try free demo
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <span className="hidden sm:inline text-muted-foreground/40">|</span>
          <a
            href="https://github.com/supercheck-io/supercheck"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Self-host for free
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="max-w-7xl mx-auto">
        <div className="rounded-2xl border bg-card p-6 md:p-8">
          <div className="text-center space-y-1.5 mb-6">
            <h2 className="text-2xl font-bold">Compare plans in detail</h2>
            <p className="text-sm text-muted-foreground">
              Everything included at a glance
            </p>
          </div>
          {pricingData && (
            <PricingComparisonTable
              categories={pricingData.featureComparison}
              overagePricing={pricingData.overagePricing}
            />
          )}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto">
        <div className="rounded-2xl border bg-card p-6 md:p-8">
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
        </div>
      </section>

      {/* Bottom contact */}
      <section className="text-center pb-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Have more questions? We&apos;d love to help.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="mailto:hello@supercheck.io">
            <Mail className="h-4 w-4 mr-2" />
            Contact Us
          </a>
        </Button>
      </section>
    </div>
  );
}

function SubscribeSkeleton() {
  return (
    <div className="max-w-7xl mx-auto py-6 md:py-8 px-4 space-y-10 md:space-y-12">
      {/* Hero Skeleton */}
      <div className="text-center space-y-3 pt-4">
        <Skeleton className="h-10 w-80 mx-auto" />
        <Skeleton className="h-5 w-96 mx-auto max-w-full" />
        <Skeleton className="h-4 w-64 mx-auto" />
      </div>

      {/* Pricing Cards Skeleton */}
      <div className="grid gap-6 lg:grid-cols-3 md:grid-cols-2 max-w-6xl mx-auto">
        {[1, 2, 3].map((i) => (
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
      <div className="flex justify-center gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-32" />
      </div>

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
    </div>
  );
}
