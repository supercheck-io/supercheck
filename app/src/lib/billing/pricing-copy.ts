import { PLAN_PRICING } from "@/lib/feature-flags";

export const PRICING_FAQS = [
  {
    question: "Does one subscription cover multiple organizations?",
    answer:
      "No. Each cloud organization needs its own subscription. Usage allowances, team members, projects, and spending controls belong to that organization and are not pooled across organizations.",
  },
  {
    question: "How is usage tracked?",
    answer:
      "Playwright minutes count browser execution time, including synthetic monitors, rounded to four decimal places per execution with no whole-minute minimum. A five-second run uses 0.0833 minutes. Each location and executed retry contributes usage; failed or canceled executions can still consume compute usage. HTTP, ping, and port checks do not consume Playwright minutes. K6 VU minutes are peak virtual users × execution time in minutes, rounded up per run, rather than accumulated active VU-time. Each completed full AI SRE report consumes one investigation unit; a report does not guarantee a diagnosis or resolution. Failed or timed-out AI investigations and billing retries are not charged; chat, triage, and evidence briefs do not consume investigation units.",
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
    answer: "No, plan quotas reset monthly on your billing date.",
  },
  {
    question: "Can I try Supercheck before subscribing?",
    answer: `Yes! Try our free demo at demo.supercheck.dev — no signup required. When you're ready, start with the Plus plan ($${PLAN_PRICING.plus.monthlyPriceCents / 100}/month) with no long-term commitment. Cancel anytime.`,
  },
  {
    question: "Do you offer enterprise plans?",
    answer:
      "Get in touch at hello@supercheck.io to discuss your requirements, usage allowances, support, SLA, and onboarding.",
  },
  {
    question: "Can I self-host Supercheck?",
    answer:
      "Yes! Supercheck core is open source under AGPLv3 and can be self-hosted with unlimited features. Visit our GitHub repository for deployment instructions.",
  },
];
