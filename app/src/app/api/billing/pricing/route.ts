import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { planLimits, overagePricing } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { PLAN_PRICING } from "@/lib/feature-flags";
import { getEnabledLocations } from "@/lib/location-registry";

const PLAN_LIMIT_FALLBACKS = {
  plus: {
    playwrightMinutesIncluded: 3000,
    k6VuMinutesIncluded: 20000,
    aiCreditsIncluded: 100,
    dataRetentionDays: 7,
    aggregatedDataRetentionDays: 30,
    jobDataRetentionDays: 30,
  },
  pro: {
    playwrightMinutesIncluded: 10000,
    k6VuMinutesIncluded: 75000,
    aiCreditsIncluded: 300,
    dataRetentionDays: 7,
    aggregatedDataRetentionDays: 90,
    jobDataRetentionDays: 90,
  },
} as const;

/**
 * GET /api/billing/pricing
 * Get available subscription plans and pricing information from database
 */
export async function GET() {
  try {
    // Fetch plan limits — location lookup is best-effort; a missing
    // locations table (pre-migration) or transient DB error must not
    // take the entire pricing page down.
    const [plans, enabledLocations] = await Promise.all([
      db
        .select()
        .from(planLimits)
        .where(or(eq(planLimits.plan, "plus"), eq(planLimits.plan, "pro"))),
      getEnabledLocations().catch(() => [] as Awaited<ReturnType<typeof getEnabledLocations>>),
    ]);

    const locationsSummary =
      enabledLocations.length > 0
        ? `${enabledLocations.length} (${enabledLocations.map((l) => l.name).join(", ")})`
        : "1 (Local)";

    // Validate that we have the required plans
    if (plans.length === 0) {
      console.error("[PRICING] No plans found in database. Run db:seed first.");
      return NextResponse.json(
        { error: "Pricing plans not configured. Please contact support." },
        { status: 503 }
      );
    }

    // Fetch overage pricing for Plus and Pro
    const overagePricingData = await db
      .select()
      .from(overagePricing)
      .where(
        or(eq(overagePricing.plan, "plus"), eq(overagePricing.plan, "pro"))
      );

    // Create a map for easy lookup
    const overagePricingMap = new Map(
      overagePricingData.map((item) => [item.plan, item])
    );

    // Build pricing response from database data
    const pricingPlans = plans
      .filter((plan) => plan.plan === "plus" || plan.plan === "pro")
      .map((plan) => {
        const planType = plan.plan as "plus" | "pro";
        const overage = overagePricingMap.get(planType);

        // Hardcoded pricing information (managed in Polar)
        const planInfo = {
          plus: {
            id: "plus",
            name: PLAN_PRICING.plus.name,
            price: PLAN_PRICING.plus.monthlyPriceCents / 100,
            interval: "month",
            description: "Best for small teams and growing projects",
          },
          pro: {
            id: "pro",
            name: PLAN_PRICING.pro.name,
            price: PLAN_PRICING.pro.monthlyPriceCents / 100,
            interval: "month",
            description: "Best for production applications and larger teams",
          },
        }[planType];

        return {
          ...planInfo,
          features: {
            monitors: plan.maxMonitors,
            playwrightMinutes: plan.playwrightMinutesIncluded,
            k6VuMinutes: plan.k6VuMinutesIncluded,
            aiCredits: plan.aiCreditsIncluded,
            concurrentExecutions: plan.runningCapacity,
            queuedJobs: plan.queuedCapacity,
            teamMembers: plan.maxTeamMembers,
            organizations: plan.maxOrganizations,
            projects: plan.maxProjects,
            statusPages: plan.maxStatusPages,
            statusPageSubscribers: plan.maxStatusPageSubscribers,
            monitorDataRetention: `${plan.dataRetentionDays}d raw / ${plan.aggregatedDataRetentionDays}d metrics`,
            jobDataRetention: `${plan.jobDataRetentionDays}d`,
            customDomains: plan.customDomains,
            ssoEnabled: plan.ssoEnabled,
            support:
              planType === "pro" ? "Priority email support" : "Email support",
            checkInterval: "1 min (Synthetic: 5 min)",
            monitoringLocations: locationsSummary,
          },
          overagePricing: overage
            ? {
                playwrightMinutes: overage.playwrightMinutePriceCents / 100,
                k6VuMinutes: overage.k6VuMinutePriceCents / 100,
                aiCredits: overage.aiCreditPriceCents / 100,
              }
            : {
                // Fallback values if not in database
                playwrightMinutes: planType === "pro" ? 0.02 : 0.03,
                k6VuMinutes: 0.01,
                aiCredits: planType === "pro" ? 0.03 : 0.05,
              },
        };
      });

    // Build feature comparison table from plan limits
    const featureComparison = [
      {
        category: "Monitoring",
        features: [
          {
            name: "Uptime Monitors",
            plus: plans.find((p) => p.plan === "plus")?.maxMonitors || "25",
            pro: plans.find((p) => p.plan === "pro")?.maxMonitors || "100",
            enterprise: "Unlimited",
          },
          {
            name: "Check Interval",
            plus: "1 min (Synthetic: 5 min)",
            pro: "1 min (Synthetic: 5 min)",
            enterprise: "1 min (Synthetic: 5 min)",
          },
          {
            name: "Monitoring Locations",
            plus: locationsSummary,
            pro: locationsSummary,
            enterprise: locationsSummary,
          },
        ],
      },
      {
        category: "Testing",
        features: [
          {
            name: "Playwright Minutes",
            plus: `${plans.find((p) => p.plan === "plus")?.playwrightMinutesIncluded || PLAN_LIMIT_FALLBACKS.plus.playwrightMinutesIncluded}/month`,
            pro: `${plans.find((p) => p.plan === "pro")?.playwrightMinutesIncluded || PLAN_LIMIT_FALLBACKS.pro.playwrightMinutesIncluded}/month`,
            enterprise: "Unlimited",
          },
          {
            name: "K6 VU Minutes",
            plus: `${plans.find((p) => p.plan === "plus")?.k6VuMinutesIncluded || PLAN_LIMIT_FALLBACKS.plus.k6VuMinutesIncluded}/month`,
            pro: `${plans.find((p) => p.plan === "pro")?.k6VuMinutesIncluded || PLAN_LIMIT_FALLBACKS.pro.k6VuMinutesIncluded}/month`,
            enterprise: "Unlimited",
          },
          {
            name: "AI Credits",
            plus: `${plans.find((p) => p.plan === "plus")?.aiCreditsIncluded || PLAN_LIMIT_FALLBACKS.plus.aiCreditsIncluded}/month`,
            pro: `${plans.find((p) => p.plan === "pro")?.aiCreditsIncluded || PLAN_LIMIT_FALLBACKS.pro.aiCreditsIncluded}/month`,
            enterprise: "Unlimited",
          },
          {
            name: "Concurrent Executions",
            plus: plans.find((p) => p.plan === "plus")?.runningCapacity || "5",
            pro: plans.find((p) => p.plan === "pro")?.runningCapacity || "10",
            enterprise: "Custom",
          },
          {
            name: "Queued Jobs",
            plus: plans.find((p) => p.plan === "plus")?.queuedCapacity || "50",
            pro: plans.find((p) => p.plan === "pro")?.queuedCapacity || "100",
            enterprise: "Custom",
          },
        ],
      },
      {
        category: "Collaboration",
        features: [
          {
            name: "Team Members",
            plus: plans.find((p) => p.plan === "plus")?.maxTeamMembers || "5",
            pro: plans.find((p) => p.plan === "pro")?.maxTeamMembers || "25",
            enterprise: "Unlimited",
          },
          {
            name: "Projects",
            plus: plans.find((p) => p.plan === "plus")?.maxProjects || "10",
            pro: plans.find((p) => p.plan === "pro")?.maxProjects || "50",
            enterprise: "Unlimited",
          },
        ],
      },
      {
        category: "Status Pages",
        features: [
          {
            name: "Public Status Pages",
            plus: plans.find((p) => p.plan === "plus")?.maxStatusPages || "3",
            pro: plans.find((p) => p.plan === "pro")?.maxStatusPages || "15",
            enterprise: "Unlimited",
          },
          {
            name: "Custom Domains",
            plus: plans.find((p) => p.plan === "plus")?.customDomains ?? true,
            pro: plans.find((p) => p.plan === "pro")?.customDomains ?? true,
            enterprise: true,
          },
          {
            name: "Subscribers per Page",
            plus: plans.find((p) => p.plan === "plus")?.maxStatusPageSubscribers || "500",
            pro: plans.find((p) => p.plan === "pro")?.maxStatusPageSubscribers || "5,000",
            enterprise: "Unlimited",
          },
        ],
      },
      {
        category: "Data & Support",
        features: [
          {
            name: "Monitor Data Retention",
            plus: `${plans.find((p) => p.plan === "plus")?.dataRetentionDays || PLAN_LIMIT_FALLBACKS.plus.dataRetentionDays}d raw / ${plans.find((p) => p.plan === "plus")?.aggregatedDataRetentionDays || PLAN_LIMIT_FALLBACKS.plus.aggregatedDataRetentionDays}d metrics`,
            pro: `${plans.find((p) => p.plan === "pro")?.dataRetentionDays || PLAN_LIMIT_FALLBACKS.pro.dataRetentionDays}d raw / ${plans.find((p) => p.plan === "pro")?.aggregatedDataRetentionDays || PLAN_LIMIT_FALLBACKS.pro.aggregatedDataRetentionDays}d metrics`,
            enterprise: "Custom",
          },
          {
            name: "Job Runs Retention",
            plus: `${plans.find((p) => p.plan === "plus")?.jobDataRetentionDays || PLAN_LIMIT_FALLBACKS.plus.jobDataRetentionDays} days`,
            pro: `${plans.find((p) => p.plan === "pro")?.jobDataRetentionDays || PLAN_LIMIT_FALLBACKS.pro.jobDataRetentionDays} days`,
            enterprise: "Custom",
          },
          {
            name: "Support",
            plus: "Email",
            pro: "Priority email",
            enterprise: "Dedicated account manager",
          },
          {
            name: "SSO/SAML",
            plus: plans.find((p) => p.plan === "plus")?.ssoEnabled ?? true,
            pro: plans.find((p) => p.plan === "pro")?.ssoEnabled ?? true,
            enterprise: true,
          },
          {
            name: "CI/CD Integration",
            plus: true,
            pro: true,
            enterprise: true,
          },
          {
            name: "Cron Job Scheduling",
            plus: true,
            pro: true,
            enterprise: true,
          },
          {
            name: "Custom SLA",
            plus: false,
            pro: false,
            enterprise: true,
          },
          {
            name: "Onboarding & Training",
            plus: false,
            pro: false,
            enterprise: true,
          },
        ],
      },
    ];

    const faqs = [
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
        answer: "No, plan quotas reset monthly on your billing date.",
      },
      {
        question: "Can I try Supercheck before subscribing?",
        answer: `Yes! Try our free demo at demo.supercheck.dev — no signup required. When you're ready, start with the Plus plan ($${PLAN_PRICING.plus.monthlyPriceCents / 100}/month) with no long-term commitment. Cancel anytime.`,
      },
      {
        question: "Do you offer enterprise plans?",
        answer:
          "Yes! Enterprise plans include unlimited usage, custom SLAs, a dedicated account manager, and personalized onboarding. Contact hello@supercheck.io to discuss your needs.",
      },
      {
        question: "Can I self-host Supercheck?",
        answer:
          "Yes! Supercheck is open source and can be self-hosted for free with unlimited features. Visit our GitHub repository for deployment instructions.",
      },
    ];

    // Build overage pricing data from database
    const plusOverage = overagePricingMap.get("plus");
    const proOverage = overagePricingMap.get("pro");

    const overagePricingResponse = {
      plus: {
        playwrightMinutes: plusOverage
          ? plusOverage.playwrightMinutePriceCents / 100
          : 0.03,
        k6VuMinutes: plusOverage
          ? plusOverage.k6VuMinutePriceCents / 100
          : 0.01,
        aiCredits: plusOverage ? plusOverage.aiCreditPriceCents / 100 : 0.05,
      },
      pro: {
        playwrightMinutes: proOverage
          ? proOverage.playwrightMinutePriceCents / 100
          : 0.02,
        k6VuMinutes: proOverage ? proOverage.k6VuMinutePriceCents / 100 : 0.01,
        aiCredits: proOverage ? proOverage.aiCreditPriceCents / 100 : 0.03,
      },
    };

    return NextResponse.json({
      plans: pricingPlans,
      featureComparison,
      faqs,
      overagePricing: overagePricingResponse,
    });
  } catch (error) {
    console.error("Error fetching pricing information:", error);
    return NextResponse.json(
      { error: "Failed to fetch pricing information" },
      { status: 500 }
    );
  }
}
