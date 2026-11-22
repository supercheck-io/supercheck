import catalog from "./plan-catalog.json";
import { trialFaqs } from "./trial-copy";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const plusCap = usd(catalog.plus.limits.defaultSpendingLimitCents);
const proCap = usd(catalog.pro.limits.defaultSpendingLimitCents);
const plusMax = usd(catalog.plus.monthlyPriceCents + catalog.plus.limits.defaultSpendingLimitCents);
const proMax = usd(catalog.pro.monthlyPriceCents + catalog.pro.limits.defaultSpendingLimitCents);
const proPrice = usd(catalog.pro.monthlyPriceCents);
const extraMember = usd(catalog.pro.extraMemberPriceCents);
const days = (n: number) => `${n.toLocaleString("en-US")} days`;
const plusLimits = catalog.plus.limits;
const proLimits = catalog.pro.limits;

/** Usage and billing answers shown on both the in-app plan picker and the marketing pricing page. */
export const SHARED_PRICING_FAQS = [
  {
    question: "Does one subscription cover the projects in my organization?",
    answer:
      "Yes. Your account has one default organization, and all projects within it share your monthly subscription, usage allowances, member limits, and spending controls. You can create and switch projects without purchasing another subscription. Projects you join by invitation use their host team's plan and allowances separately; joining a paid team does not require a personal subscription. Only the host organization owner can manage billing.",
  },
  {
    question: "Where do Cloud checks run?",
    answer:
      "HTTP, SSL, ping, port, and MCP monitors can run from Europe, North America, and Asia Pacific. Browser synthetic monitors, Playwright tests, and k6 load tests run in Europe. Enterprise can use custom locations.",
  },
  {
    question: "Why do browser checks and k6 tests run only in Europe?",
    answer:
      "At launch, browser and k6 execution is available in Europe only. They can still test any public URL worldwide, and each run currently uses your browser minutes or VU-minutes once. If browser execution is enabled in more locations later, each location counts separately. Enterprise can use other locations.",
  },
  {
    question: "How are browser execution minutes measured?",
    answer:
      "Playwright tests and synthetic monitors share your minute allowance. Execution time is rounded to four decimal places in minutes per run, without a whole-minute minimum. A five-second run uses 0.0833 minutes. Browser checks currently run from one location (Europe). Each executed retry contributes usage, and if browser checks are enabled in more locations, each location counts separately. Failed or canceled executions can still consume compute usage. HTTP, SSL, ping, port, and MCP checks from any location do not consume Playwright minutes.",
  },
  {
    question: "How are load tests measured?",
    answer:
      "K6 usage is peak virtual users multiplied by execution duration in minutes, rounded up to a whole VU-minute per run. This can exceed accumulated active VU-time for ramping tests. Review your load profile and spending settings before running a large test.",
  },
  {
    question: "How do AI credits work?",
    answer:
      "Each plan includes a monthly pool of AI credits for test generation, test fixes, and failure analysis, subject to fair use. Automated bulk use and abuse are restricted. Your account shows your monthly allowance and remaining credits. Each accepted action reserves one credit before generation or analysis starts; the credit is returned if the AI fails or produces no output. There are no AI credit overages; upgrade or wait for your next billing cycle when the pool is exhausted.",
  },
  {
    question: "What counts as an AI SRE investigation?",
    answer:
      "Full AI SRE investigations use a separate allowance from AI credits. Each completed full report consumes one investigation unit, without guaranteeing a diagnosis or resolution. Failed or timed-out full investigations and billing retries do not consume investigation units. AI SRE chat, triage, and evidence briefs do not consume investigation units.",
  },
  {
    question: "What happens if I exceed my limits?",
    answer:
      `Playwright minutes, K6 VU-minutes, and completed full AI SRE reports use the overage rates shown above, up to your monthly overage cap. AI credits are included, subject to fair use, with no overages. Monitor, project, and status-page limits require an upgrade rather than an overage payment. ${catalog.pro.name} includes ${catalog.pro.limits.maxTeamMembers} team members, and the owner can add more at ${extraMember} per extra member per month, prorated, up to ${catalog.pro.maxTotalMembers} members; on ${catalog.plus.name}, more members require an upgrade to ${catalog.pro.name}.`,
  },
  {
    question: "How can I control overage spending?",
    answer:
      `Every paid plan starts with a monthly overage cap and a hard stop: ${plusCap} on Plus and ${proCap} on Pro. With the default cap and hard stop, a month costs about ${plusMax} on Plus or ${proMax} on Pro at most before taxes, plus any extra ${catalog.pro.name} member seats. Raising the cap or turning off the hard stop allows more overage. Owners and admins can raise or lower the cap, turn off the hard stop, or reset to the plan default in Organization admin, Subscription, spending controls. Only the owner can manage the paid subscription. Alert emails go out at 80% of the cap (and at 90% when the hard stop is on) and at 100%. In-flight execution usage can run slightly past the cap, so it is not an exact invoice cap. Plus with a full cap costs ${plusMax}, the same as the Pro price of ${proPrice}, so a team that regularly reaches the Plus cap should compare it with Pro.`,
  },
  {
    question: "What pauses when I reach my overage cap?",
    answer:
      "With the hard stop on, new browser (Playwright) checks, test and job runs, k6 load tests, and full AI SRE investigations pause until the owner raises the cap or your billing period resets. HTTP, website, ping, port, and MCP monitors keep running. With the hard stop off, usage keeps billing at the overage rates and alerts still go out.",
  },
  {
    question: "Do unused allowances roll over?",
    answer: "No. Execution minutes, AI credits, and AI SRE investigation allowances reset monthly on your billing date.",
  },
  {
    question: "What happens if I cancel?",
    answer:
      `Your plan stays active until the end of the period you paid for. Once that period ends, your monitors are paused and your status pages are archived, so nothing keeps running without a plan. Your tests, jobs, monitors, and status pages are kept. Check details older than ${days(catalog.trial.retention.dataRetentionDays)} are deleted, as on an account without a plan, and other history follows normal data retention. When you subscribe again, paused monitors resume and archived status pages are republished automatically.`,
  },
  {
    question: "How long is check history kept?",
    answer:
      `Check details, the result of every individual check with its response time and error, are kept for at least ${days(plusLimits.dataRetentionDays)} on ${catalog.plus.name} and ${days(proLimits.dataRetentionDays)} on ${catalog.pro.name}. Uptime history is kept longer as hourly and daily summaries: hourly charts for ${days(plusLimits.aggregatedDataRetentionDays)} on ${catalog.plus.name} and ${days(proLimits.aggregatedDataRetentionDays)} on ${catalog.pro.name}, and daily uptime for at least ${days(catalog.minDailyAggregateRetentionDays)} on every plan, which is what a status page's 90-day uptime bar shows. Each status change (a monitor going down or recovering) is kept as well. Older data is deleted automatically and cannot be restored. Enterprise plans can have custom retention.`,
  },
];

export const PRICING_FAQS = [
  ...SHARED_PRICING_FAQS,
  {
    question: "Can I change plans?",
    answer:
      "The organization owner can change plans in Manage subscription. Review the effective date and any prorated charges in the Polar portal before confirming. If the new plan has lower limits, the newest monitors and published status pages above them are paused or archived; nothing is deleted, and you can choose which ones run by pausing others first.",
  },
  ...trialFaqs(),
  {
    question: "Do you offer enterprise plans?",
    answer:
      "Get in touch at hello@supercheck.io to discuss your requirements, usage allowances, support, SLA, and onboarding.",
  },
];

export type PlanFeature = string | { text: string; hint: string };

/** Plan limits the feature list needs; the catalog's `limits` and the pricing API both supply them. */
export interface PlanFeatureLimits {
  maxMonitors: number;
  playwrightMinutesIncluded: number;
  k6VuMinutesIncluded: number;
  aiCreditsIncluded: number;
  sreInvestigationUnitsIncluded: number | string; // a decimal string in the catalog
  defaultSpendingLimitCents: number;
  runningCapacity: number;
  maxTeamMembers: number;
  maxProjects: number;
  maxStatusPages: number;
  maxStatusPageSubscribers: number;
}

const fmt = (value: number | string) => Number(value).toLocaleString("en-US");

/** The plan card feature lines, shared by the in-app plan picker and the marketing pricing page. */
/** `overageRates` (e.g. "$0.01/min Playwright") is shown under the cap where no overage table is on the page. */
export function planFeatureList(id: "plus" | "pro", limits: PlanFeatureLimits, overageRates?: string): PlanFeature[] {
  const members = `${fmt(limits.maxTeamMembers)} team members, ${fmt(limits.maxProjects)} projects`;
  return [
    `${fmt(limits.maxMonitors)} monitors`,
    {
      text: `${fmt(limits.playwrightMinutesIncluded)} Playwright minutes/month`,
      hint: `About ${fmt(limits.playwrightMinutesIncluded * 12)} five-second Playwright runs`,
    },
    `${fmt(limits.k6VuMinutesIncluded)} k6 VU-minutes/month`,
    `${fmt(limits.aiCreditsIncluded)} AI credits/month, fair use`,
    `${fmt(limits.sreInvestigationUnitsIncluded)} completed AI SRE investigations/month`,
    { text: `${usd(limits.defaultSpendingLimitCents)} default overage cap`, hint: overageRates ? `Overage: ${overageRates}. Hard stop at the cap; owners can change it.` : "Monthly cap with a hard stop. Owners can change it." },
    `${fmt(limits.runningCapacity)} concurrent runs`,
    id === "pro"
      ? { text: members, hint: `Then ${extraMember} per extra member per month, prorated, up to ${fmt(catalog.pro.maxTotalMembers)} members` }
      : members,
    `${fmt(limits.maxStatusPages)} status pages with custom domains, ${fmt(limits.maxStatusPageSubscribers)} subscribers each`,
    id === "pro" ? "Priority email support" : "Email support",
  ];
}

export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  description: "For organizations with custom volume, locations or compliance needs",
  features: [
    "Custom allowances for monitors, minutes and investigations",
    "Custom monitoring and execution locations",
    "Bring your own AI provider",
    "Custom data retention",
    "SLA with a dedicated account manager",
    "Onboarding and training",
  ] as PlanFeature[],
};

/** One-line plan basics shown under the plan grid on both pricing pages. */
export const PLAN_BASICS = [
  `Priced per organization; extra ${catalog.pro.name} seats billed per seat`,
  "Spending limits and usage alerts",
  "Cancel anytime",
];
