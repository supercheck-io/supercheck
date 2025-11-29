import { NextResponse } from "next/server";

/**
 * GET /api/billing/pricing
 * Get available subscription plans and pricing information
 */
export async function GET() {
  try {
    const pricing = {
      plans: [
        {
          id: "plus",
          name: "Plus",
          price: 49,
          interval: "month",
          description: "Best for small teams and growing projects",
          features: {
            monitors: 25,
            playwrightMinutes: 2500,
            k6VuMinutes: 6000,
            concurrentExecutions: 5,
            queuedJobs: 50,
            teamMembers: 5,
            organizations: 2,
            projects: 10,
            statusPages: 3,
            dataRetention: "30 days",
            customDomains: false,
            ssoEnabled: false,
            support: "Email support",
          },
          overagePricing: {
            playwrightMinutes: 0.03,
            k6VuMinutes: 0.005,
          },
        },
        {
          id: "pro",
          name: "Pro",
          price: 149,
          interval: "month",
          description: "Best for production applications and larger teams",
          features: {
            monitors: 100,
            playwrightMinutes: 7500,
            k6VuMinutes: 40000,
            concurrentExecutions: 10,
            queuedJobs: 100,
            teamMembers: 25,
            organizations: 10,
            projects: 50,
            statusPages: 15,
            dataRetention: "90 days",
            customDomains: true,
            ssoEnabled: true,
            support: "Priority email support",
          },
          overagePricing: {
            playwrightMinutes: 0.015,
            k6VuMinutes: 0.003,
          },
        },
      ],
      featureComparison: [
        {
          category: "Monitoring",
          features: [
            { name: "Uptime Monitors", plus: "25", pro: "100" },
            { name: "Check Interval", plus: "1 minute (Synthetic: 5 min)", pro: "1 minute (Synthetic: 5 min)" },
            { name: "Monitoring Locations", plus: "All 3 locations", pro: "All 3 locations" },
          ],
        },
        {
          category: "Testing",
          features: [
            { name: "Playwright Minutes", plus: "2,500/month", pro: "7,500/month" },
            { name: "K6 VU Minutes", plus: "6,000/month", pro: "40,000/month" },
            { name: "Concurrent Executions", plus: "5", pro: "10" },
            { name: "Queued Jobs", plus: "50", pro: "100" },
          ],
        },
        {
          category: "Collaboration",
          features: [
            { name: "Team Members", plus: "5", pro: "25" },
            { name: "Organizations", plus: "2", pro: "10" },
            { name: "Projects", plus: "10", pro: "50" },
          ],
        },
        {
          category: "Status Pages",
          features: [
            { name: "Public Status Pages", plus: "3", pro: "15" },
            { name: "Custom Domains", plus: "✗", pro: "✓" },
          ],
        },
        {
          category: "Data & Support",
          features: [
            { name: "Data Retention", plus: "30 days", pro: "90 days" },
            { name: "Email Support", plus: "✓", pro: "✓ Priority" },
            { name: "SSO/SAML", plus: "✗", pro: "✓" },
            { name: "API Access", plus: "✓", pro: "✓ Enhanced" },
          ],
        },
      ],
      selfHosted: {
        name: "Self-Hosted",
        price: 0,
        description: "Free and open source",
        features: {
          monitors: "Unlimited",
          playwrightMinutes: "Unlimited",
          k6VuMinutes: "Unlimited",
          concurrentExecutions: "Environment-based",
          queuedJobs: "Environment-based",
          teamMembers: "Unlimited",
          organizations: "Unlimited",
          projects: "Unlimited",
          statusPages: "Unlimited",
          dataRetention: "Unlimited",
          customDomains: true,
          ssoEnabled: true,
          support: "Community support",
        },
      },
      faqs: [
        {
          question: "How is usage tracked?",
          answer: "Playwright Minutes count total browser execution time. K6 VU Minutes are calculated as Virtual Users × execution time in minutes. Monitors count against Playwright minutes for each check.",
        },
        {
          question: "What happens if I exceed my limits?",
          answer: "Usage-based billing automatically applies. Overage charges are billed monthly. You'll receive email alerts at 80% and 100% of quota.",
        },
        {
          question: "Can I change plans?",
          answer: "Yes! Upgrades take effect immediately. Downgrades take effect at the next billing cycle. Pro-rated billing applies for mid-cycle changes.",
        },
        {
          question: "Do unused minutes roll over?",
          answer: "No, plan quotas reset monthly on your billing date.",
        },
        {
          question: "Is there a free trial?",
          answer: "We don't offer a free tier for cloud-hosted, but you can try the self-hosted edition (fully featured, free forever) or start with the Plus plan ($49/month) with no long-term commitment.",
        },
      ],
    };

    return NextResponse.json(pricing);
  } catch (error) {
    console.error("Error fetching pricing information:", error);
    return NextResponse.json(
      { error: "Failed to fetch pricing information" },
      { status: 500 }
    );
  }
}
