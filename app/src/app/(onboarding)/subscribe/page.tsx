"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Check, 
  ArrowRight, 
  Sparkles, 
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/utils/auth-client";

interface PricingPlan {
  id: string;
  name: string;
  price: number;
  interval: string;
  description: string;
  features: {
    monitors: string | number;
    playwrightMinutes: string | number;
    k6VuHours: string | number;
    teamMembers: string | number;
    projects: string | number;
    statusPages: string | number;
    dataRetention: string;
    customDomains?: boolean;
    ssoEnabled?: boolean;
  };
  overagePricing: {
    playwrightMinutes: number;
    k6VuHours: number;
  };
}

interface PricingData {
  plans: PricingPlan[];
  featureComparison: Array<{
    category: string;
    features: Array<{ name: string; plus: string; pro: string }>;
  }>;
  faqs: Array<{ question: string; answer: string }>;
}

const defaultFaqs = [
  {
    question: "How is usage tracked?",
    answer: "Playwright Minutes count total browser execution time. K6 VU Hours are calculated as Virtual Users × execution time in hours. Monitors count against Playwright minutes for each check."
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
  const searchParams = useSearchParams();
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const isNewUser = searchParams.get("setup") === "true";
  const isRequired = searchParams.get("required") === "true";

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
    <div className="max-w-6xl mx-auto space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          {isNewUser ? "Welcome to Supercheck!" : "Choose Your Plan"}
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {isNewUser || isRequired 
            ? "Start monitoring in minutes"
            : "Simple, transparent pricing"
          }
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          {isNewUser || isRequired
            ? "Select a plan to unlock all features and start monitoring your applications with confidence."
            : "Choose the plan that's right for your team. All plans include core features."
          }
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
        {plans.map((plan) => (
          <Card 
            key={plan.id} 
            className={`relative overflow-hidden transition-all hover:shadow-xl ${
              plan.id === "pro" 
                ? "border-primary shadow-lg scale-[1.02]" 
                : "hover:border-primary/50"
            }`}
          >
            {plan.id === "pro" && (
              <div className="absolute top-0 right-0">
                <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground px-4 py-1">
                  Most Popular
                </Badge>
              </div>
            )}
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-5xl font-bold">${plan.price}</span>
                <span className="text-muted-foreground text-lg">/{plan.interval}</span>
              </div>
              <CardDescription className="text-base mt-2">
                {plan.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Key Features */}
              <ul className="space-y-3">
                <FeatureItem>
                  <strong>{plan.features.monitors}</strong> monitors
                </FeatureItem>
                <FeatureItem>
                  <strong>{plan.features.playwrightMinutes}</strong> Playwright minutes/mo
                </FeatureItem>
                <FeatureItem>
                  <strong>{plan.features.k6VuHours}</strong> k6 VU hours/mo
                </FeatureItem>
                <FeatureItem>
                  <strong>{plan.features.teamMembers}</strong> team members
                </FeatureItem>
                <FeatureItem>
                  <strong>{plan.features.projects}</strong> projects
                </FeatureItem>
                <FeatureItem>
                  <strong>{plan.features.dataRetention}</strong> data retention
                </FeatureItem>
                {plan.features.customDomains && (
                  <FeatureItem>
                    Custom domains for status pages
                  </FeatureItem>
                )}
                {plan.features.ssoEnabled && (
                  <FeatureItem>
                    SSO authentication
                  </FeatureItem>
                )}
              </ul>

              {/* CTA Button */}
              <Button 
                className="w-full h-12 text-base font-medium"
                size="lg"
                variant={plan.id === "pro" ? "default" : "outline"}
                onClick={() => handleSubscribe(plan.id)}
                disabled={subscribing !== null}
              >
                {subscribing === plan.id ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Processing...
                  </>
                ) : (
                  <>
                    Get started with {plan.name}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              {/* Overage Pricing */}
              <p className="text-xs text-muted-foreground text-center">
                Overage: ${plan.overagePricing.playwrightMinutes}/min Playwright, 
                ${plan.overagePricing.k6VuHours}/VU-hr k6
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FAQs */}
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Frequently Asked Questions</CardTitle>
          <CardDescription className="text-center">
            Everything you need to know about our plans
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left font-medium">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Contact CTA */}
      <div className="text-center space-y-4 pb-8">
        <p className="text-muted-foreground">
          Need a custom enterprise plan or have questions?
        </p>
        <Button variant="outline" size="lg" asChild>
          <a href="mailto:support@supercheck.io">Contact Sales</a>
        </Button>
      </div>
    </div>
  );
}

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <div className="flex-shrink-0 h-5 w-5 rounded-full bg-green-500/10 flex items-center justify-center">
        <Check className="h-3 w-3 text-green-500" />
      </div>
      <span className="text-sm">{children}</span>
    </li>
  );
}

function SubscribeSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <div className="text-center space-y-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-12 w-96 mx-auto" />
        <Skeleton className="h-6 w-80 mx-auto" />
      </div>
      <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-8 w-24 mb-4" />
            <Skeleton className="h-12 w-32 mb-4" />
            <Skeleton className="h-4 w-full mb-6" />
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
            <Skeleton className="h-12 w-full mt-6" />
          </Card>
        ))}
      </div>
    </div>
  );
}
