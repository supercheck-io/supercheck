"use client";

import { useEffect, useState } from "react";
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
    dataRetention: string;
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
    answer: "Playwright Minutes count total browser execution time. K6 VU Minutes are calculated as Virtual Users × execution time in minutes. Monitors count against Playwright minutes for each check."
  },
  {
    question: "What happens if I exceed my limits?",
    answer: "Usage-based billing automatically applies. Overage charges are billed monthly. You'll receive email alerts at 80% and 100% of quota."
  },
  {
    question: "Can I change plans?",
    answer: "Yes! Upgrades take effect immediately. Downgrades take effect at the next billing cycle. Pro-rated billing applies for mid-cycle changes."
  },
  {
    question: "Do unused minutes roll over?",
    answer: "No, included minutes reset each billing cycle. However, you can always upgrade your plan if you consistently need more resources."
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards (Visa, Mastercard, American Express) through our secure payment processor Polar."
  },
  {
    question: "Is there a free trial?",
    answer: "We don't offer a free trial, but you can start with our Plus plan and upgrade or downgrade at any time based on your needs."
  },
  {
    question: "Can I cancel my subscription?",
    answer: "Yes, you can cancel anytime. Your subscription will remain active until the end of the current billing period."
  },
  {
    question: "Do you offer enterprise plans?",
    answer: "Yes! Contact us for custom enterprise plans with dedicated support, custom SLAs, and volume discounts."
  }
];


export default function SubscribePage() {
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/pricing")
      .then((res) => res.json())
      .then((data) => setPricingData(data))
      .catch((error) => {
        console.error("Error fetching pricing:", error);
        toast.error("Failed to load pricing information");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSubscribe = async (planSlug: string) => {
    setSubscribing(planSlug);
    try {
      // Get the user's organization ID to link the subscription
      const orgsResponse = await fetch("/api/organizations");
      const orgsResult = await orgsResponse.json();
      // API returns { success: true, data: [...] }
      const orgs = orgsResult.data || orgsResult;
      const organizationId = orgs?.[0]?.id;

      if (!organizationId) {
        console.error("No organization found in response:", orgsResult);
        throw new Error("No organization found");
      }

      // Use Better Auth Polar checkout client method with referenceId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authClient as any).checkout({
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

  const plans = pricingData?.plans || [];
  const faqs = pricingData?.faqs?.length ? pricingData.faqs : defaultFaqs;

  return (
    <div className="max-w-7xl mx-auto py-6 md:py-8 px-4 space-y-10 md:space-y-12">
      {/* Hero Section */}
      <section className="text-center space-y-2 pt-2">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Choose your plan
        </h1>
        <p className="text-base text-muted-foreground max-w-2xl mx-auto">
          Select the perfect plan for your team. Upgrade or downgrade anytime.
        </p>
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
                `${plan.features.monitors.toLocaleString()} uptime monitors`,
                `${plan.features.playwrightMinutes.toLocaleString()} Playwright mins/mo`,
                `${plan.features.k6VuMinutes.toLocaleString()} K6 VU-mins/mo`,
                `${plan.features.aiCredits.toLocaleString()} AI credits/mo`,
                `${plan.features.teamMembers} team members`,
                `${plan.features.projects} projects`,
                `${plan.features.dataRetention} data retention`,
                plan.features.customDomains ? "Custom domains" : "Standard domains",
              ]}
              overageText={`Overage: $${plan.overagePricing.playwrightMinutes}/min · $${plan.overagePricing.k6VuMinutes}/VU-min · $${plan.overagePricing.aiCredits}/credit`}
              ctaText={`Get Started with ${plan.name}`}
              ctaVariant={plan.id === "pro" ? "default" : "outline"}
              onCtaClick={() => handleSubscribe(plan.id)}
              loading={subscribing === plan.id}
              highlighted={plan.id === "pro"}
            />
          ))}
        </div>
        
        {/* Self-hosted mention */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          Want unlimited usage?{" "}
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
          <h2 className="text-2xl font-bold">
            Full feature comparison
          </h2>
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
          <h2 className="text-2xl font-bold">
            Frequently asked questions
          </h2>
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
          <a href="mailto:support@supercheck.io">Contact Sales</a>
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
