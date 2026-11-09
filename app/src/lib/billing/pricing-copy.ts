import catalog from "./plan-catalog.json";
import { trialFaqs } from "./trial-copy";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const plusCap = usd(catalog.plus.limits.defaultSpendingLimitCents);
const proCap = usd(catalog.pro.limits.defaultSpendingLimitCents);
const plusMax = usd(catalog.plus.monthlyPriceCents + catalog.plus.limits.defaultSpendingLimitCents);
const proMax = usd(catalog.pro.monthlyPriceCents + catalog.pro.limits.defaultSpendingLimitCents);
const proPrice = usd(catalog.pro.monthlyPriceCents);

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
      "HTTP, SSL, ping, and port monitors can run from Europe, North America, and Asia Pacific. Browser synthetic monitors, Playwright tests, and k6 load tests run in Europe. Enterprise can use custom locations, and self-hosted deployments can run checks wherever you deploy.",
  },
  {
    question: "Why do browser checks and k6 tests run only in Europe?",
    answer:
      "At launch, browser and k6 execution is available in Europe only. They can still test any public URL worldwide, and each run currently uses your browser minutes or VU-minutes once. If browser execution is enabled in more locations later, each location counts separately. Enterprise and self-hosted deployments can use other locations.",
  },
  {
    question: "How are browser execution minutes measured?",
    answer:
      "Playwright tests and synthetic monitors share your minute allowance. Execution time is rounded to four decimal places in minutes per run, without a whole-minute minimum. A five-second run uses 0.0833 minutes. Browser checks currently run from one location (Europe). Each executed retry contributes usage, and if browser checks are enabled in more locations, each location counts separately. Failed or canceled executions can still consume compute usage. HTTP, SSL, ping, and port checks from any location do not consume Playwright minutes.",
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
      "Playwright minutes, K6 VU-minutes, and completed full AI SRE reports use the overage rates shown above, up to your monthly overage cap. AI credits are included, subject to fair use, with no overages. Monitor, member, project, and status-page limits require an upgrade rather than an overage payment.",
  },
  {
    question: "How can I control overage spending?",
    answer:
      `Every paid plan starts with a monthly overage cap and a hard stop: ${plusCap} on Plus and ${proCap} on Pro. A month costs at most ${plusMax} on Plus or ${proMax} on Pro before taxes, unless the owner raises the cap. Owners and admins can raise or lower the cap, turn off the hard stop, or reset to the plan default in Organization admin, Subscription, spending controls. Only the owner can manage the paid subscription. Alert emails go out at 80% of the cap (and at 90% when the hard stop is on) and at 100%. In-flight execution usage can run slightly past the cap, so it is not an exact invoice cap. Plus with a full cap costs ${plusMax}, the same as the Pro price of ${proPrice}, so a team that regularly reaches the Plus cap should compare it with Pro.`,
  },
  {
    question: "What pauses when I reach my overage cap?",
    answer:
      "With the hard stop on, new browser (Playwright) checks, test and job runs, k6 load tests, and full AI SRE investigations pause until the owner raises the cap or your billing period resets. HTTP, website, ping, and port monitors keep running. With the hard stop off, usage keeps billing at the overage rates and alerts still go out.",
  },
  {
    question: "Do unused allowances roll over?",
    answer: "No. Execution minutes, AI credits, and AI SRE investigation allowances reset monthly on your billing date.",
  },
  {
    question: "What happens if I cancel?",
    answer:
      "Your plan stays active until the end of the period you paid for. Once that period ends, your monitors are paused and your status pages are archived, so nothing keeps running without a plan. Nothing is deleted by the plan ending, though normal data retention still applies to old results and artifacts, and when you subscribe again, paused monitors resume and archived status pages are republished automatically.",
  },
];

export const DEMO_FAQ_QUESTION = "Can I try Supercheck before subscribing?";

export const PRICING_FAQS = [
  ...SHARED_PRICING_FAQS,
  {
    question: "Can I change plans?",
    answer:
      "The organization owner can change plans in Manage subscription. Review the effective date and any prorated charges in the Polar portal before confirming. If the new plan has lower limits, the newest monitors and published status pages above them are paused or archived; nothing is deleted, and you can choose which ones run by pausing others first.",
  },
  ...trialFaqs(),
  {
    question: DEMO_FAQ_QUESTION,
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
      "Yes. Supercheck core is open source under AGPLv3. Self-host on your infrastructure with unlimited Supercheck usage at no license cost, and with no trial or usage limits. You still pay your own infrastructure and AI provider costs. See the self-hosting guide at supercheck.io/docs/app/deployment/self-hosted.",
  },
];
