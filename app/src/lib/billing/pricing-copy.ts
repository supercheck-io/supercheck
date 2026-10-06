export const PRICING_FAQS = [
  {
    question: "Does one subscription cover the projects in my organization?",
    answer:
      "Yes. Your account has one default organization, and all projects within it share your monthly subscription, usage allowances, member limits, and spending controls. You can create and switch projects without purchasing another subscription. Projects you join by invitation use their host team's plan and allowances separately; joining a paid team does not require a personal subscription. Only the host organization owner can manage billing.",
  },
  {
    question: "How are browser execution minutes measured?",
    answer:
      "Playwright tests and synthetic monitors share your minute allowance. Execution time is rounded to four decimal places in minutes per run, without a whole-minute minimum. A five-second run uses 0.0833 minutes. Each location and executed retry contributes usage. Failed or canceled executions can still consume compute usage. HTTP, ping, and port checks do not consume Playwright minutes.",
  },
  {
    question: "How are load tests measured?",
    answer:
      "K6 usage is peak virtual users multiplied by execution duration in minutes, rounded up to a whole VU-minute per run. This can exceed accumulated active VU-time for ramping tests. Review your load profile and spending settings before running a large test.",
  },
  {
    question: "How do AI credits work?",
    answer:
      "AI credits are a hard monthly pool for test generation, test fixes, and failure analysis. Each accepted action uses one credit before generation or analysis starts, even if it later fails. There are no AI credit overages; upgrade or wait for your next billing cycle when the pool is exhausted.",
  },
  {
    question: "What counts as an AI SRE investigation?",
    answer:
      "Full AI SRE investigations use a separate allowance from AI credits. Each completed full report consumes one investigation unit, without guaranteeing a diagnosis or resolution. Failed or timed-out full investigations and billing retries do not consume investigation units. AI SRE chat, triage, and evidence briefs do not consume investigation units.",
  },
  {
    question: "What happens if I exceed my limits?",
    answer:
      "Playwright minutes, K6 VU-minutes, and completed full AI SRE reports use the overage rates shown above. AI credits have a hard monthly limit with no overages. Monitor, member, project, and status-page limits require an upgrade rather than an overage payment.",
  },
  {
    question: "How can I control overage spending?",
    answer:
      "Organization owners and admins can configure a monthly spending limit, billing contacts, threshold alerts, and optional blocking of new billable executions and full investigations. Basic uptime checks continue at the spending limit. Only the owner can manage the paid subscription. Limits apply to usage overages in addition to the base subscription. In-flight execution usage can exceed a configured limit, so it is not a guaranteed invoice cap.",
  },
  {
    question: "Can I change plans?",
    answer:
      "The organization owner can change plans in Manage subscription. Review the effective date and any prorated charges in the Polar portal before confirming.",
  },
  {
    question: "Do unused allowances roll over?",
    answer: "No. Execution minutes, AI credits, and AI SRE investigation allowances reset monthly on your billing date.",
  },
  {
    question: "Can I try Supercheck before subscribing?",
    answer: "Yes. Try our free demo at demo.supercheck.dev — no signup required. When you are ready, choose a monthly plan. Cancel anytime.",
  },
  {
    question: "Do you offer enterprise plans?",
    answer:
      "Get in touch at hello@supercheck.io to discuss your requirements, usage allowances, support, SLA, and onboarding.",
  },
  {
    question: "Can I self-host Supercheck?",
    answer:
      "Yes. Supercheck core is open source under AGPLv3. Self-host on your infrastructure with unlimited Supercheck usage at no license cost. You still pay your own infrastructure and AI provider costs. See the self-hosting guide at supercheck.io/docs/app/deployment/self-hosted.",
  },
];
