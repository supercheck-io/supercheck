import catalog from "../../../app/src/lib/billing/plan-catalog.json";

// Competitor figures are reviewed separately from the shared Supercheck catalog.
export const COMPETITOR_AS_OF = 'October 2026';

export const MINUTES_PER_MONTH = 30 * 24 * 60;

export interface SupercheckPlanCost {
  id: 'plus' | 'pro';
  name: string;
  monthlyFee: number;
  includedPlaywrightMinutes: number;
  overagePerMinute: number;
  maxMonitors: number;
  runningCapacity: number;
}

export const SUPERCHECK_PLANS: readonly SupercheckPlanCost[] = (["plus", "pro"] as const).map(id => ({
  id,
  name: catalog[id].name,
  monthlyFee: catalog[id].monthlyPriceCents / 100,
  includedPlaywrightMinutes: catalog[id].limits.playwrightMinutesIncluded,
  overagePerMinute: catalog[id].overageCents.playwrightMinutes / 100,
  maxMonitors: catalog[id].limits.maxMonitors,
  runningCapacity: catalog[id].limits.runningCapacity,
}));

// Supercheck's shortest interval for browser (synthetic) checks.
export const MIN_SYNTHETIC_INTERVAL_MINUTES = 5;

export interface RunPricedTier {
  name: string;
  monthlyFee: number;
  includedRuns: number;
  // Hard-capped tiers stop running at the allowance instead of billing overage.
  hardCap?: boolean;
  overagePer1kRuns: number;
}

export interface Competitor {
  id: 'checkly' | 'datadog' | 'betterstack' | 'browserstack';
  name: string;
  asOf: string;
  billing: string;
  note: string;
}

export const CHECKLY_TIERS: readonly RunPricedTier[] = [
  { name: 'Hobby', monthlyFee: 0, includedRuns: 1_000, hardCap: true, overagePer1kRuns: 0 },
  { name: 'Starter', monthlyFee: 24, includedRuns: 3_000, overagePer1kRuns: 6.5 },
  { name: 'Team', monthlyFee: 64, includedRuns: 12_000, overagePer1kRuns: 6.25 },
];

// Datadog bills browser test runs with no base fee; a run covers up to 25 steps.
export const DATADOG_PER_1K_RUNS = 12;
export const DATADOG_ON_DEMAND_PER_1K_RUNS = 18;

// Better Stack sells Playwright minutes at $1 per 100 minutes.
export const BETTERSTACK_PER_MINUTE = 0.01;

export const COMPETITORS: readonly Competitor[] = [
  {
    id: 'checkly',
    name: 'Checkly',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Browser checks bill one run per execution; Playwright Check Suites bill one run per 30 seconds, so we price classic browser checks. Plans shown at annual-billing rates.',
    note: 'Hobby stops at 1,000 runs. Starter and Team bill $6.50 and $6.25 per 1,000 runs beyond the allowance.',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Browser tests bill per run at $12 per 1,000 on annual billing ($18 on-demand). One run covers up to 25 steps.',
    note: 'No base fee shown for this product; other Datadog products are priced separately. Running CI tests in parallel needs a parallelization add-on, from $79 a month per additional parallelization on annual billing.',
  },
  {
    id: 'betterstack',
    name: 'Better Stack',
    asOf: COMPETITOR_AS_OF,
    billing: 'Playwright minutes are $1 per 100 minutes.',
    note: 'Monitors, responders, and extra status pages are billed separately and are not included in this estimate.',
  },
  {
    id: 'browserstack',
    name: 'BrowserStack',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Automate bills per parallel test with unlimited testing minutes, so its cost depends on how many tests you run at once, not on runs or minutes. On monthly billing, 1 parallel test costs $79 to $275 a month, 2 cost $159 to $550 and 5 cost $399 to $1,375, depending on browser and device coverage. Prices above 5 parallel tests are not published.',
    note: 'Its price per parallel test is not directly comparable to per-run or per-minute pricing. The pages we reviewed describe running tests from your CI or code, not a built-in scheduler, so BrowserStack is shown for reference and is not part of the cost ranking.',
  },
];


// What each vendor sells, from the same public pricing pages. "Not listed"
// means the vendor's pricing page names no such product; it is not a claim
// that the capability is impossible to assemble from other tools.
// BrowserStack Automate list prices on monthly billing, read from the plan cards
// on its pricing page (October 2026). The low end is the Chrome-only plan and the
// high end is Desktop & Mobile Pro. BrowserStack publishes no price above 5.
export const BROWSERSTACK_AUTOMATE_MONTHLY: readonly {
  parallelTests: number;
  min: number;
  max: number;
}[] = [
  { parallelTests: 1, min: 79, max: 275 },
  { parallelTests: 2, min: 159, max: 550 },
  { parallelTests: 5, min: 399, max: 1375 },
];

export interface CapabilityRow {
  name: string;
  supercheck: string;
  checkly: string;
  datadog: string;
  betterstack: string;
  browserstack: string;
}

export const VENDORS = [
  { key: 'supercheck', name: 'Supercheck' },
  { key: 'checkly', name: 'Checkly' },
  { key: 'datadog', name: 'Datadog' },
  { key: 'betterstack', name: 'Better Stack' },
  { key: 'browserstack', name: 'BrowserStack' },
] as const;

export const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  {
    name: 'Scheduled production monitoring',
    supercheck: 'HTTP, SSL, ping, port, browser',
    checkly: 'Included',
    datadog: 'Included',
    betterstack: 'Included',
    browserstack: 'Not listed',
  },
  {
    name: 'Parallel test runs',
    supercheck: `${catalog.plus.limits.runningCapacity}–${catalog.pro.limits.runningCapacity} at once, extra runs queue`,
    checkly: 'No limit listed',
    datadog: 'CI add-on, from $79/mo',
    betterstack: 'No limit listed',
    browserstack: 'Billed per parallel test',
  },
  {
    name: 'Trigger from CI/CD',
    supercheck: 'API trigger key and CLI',
    checkly: 'CLI trigger',
    datadog: 'CLI and API',
    betterstack: 'Not listed',
    browserstack: 'From your CI pipeline',
  },
  {
    name: 'Requirements traceability',
    supercheck: 'Requirements and coverage',
    checkly: 'Not listed',
    datadog: 'Not listed',
    betterstack: 'Not listed',
    browserstack: 'Traceability report',
  },
  {
    name: 'Browser recorder',
    supercheck: 'Browser extension (Chrome, Edge)',
    checkly: 'Not listed',
    datadog: 'Chrome extension',
    betterstack: 'Not listed',
    browserstack: 'Low-code recorder',
  },
  {
    name: 'AI test creation and repair',
    supercheck: 'AI Create, Fix and Analyze',
    checkly: 'Via MCP and coding agents',
    datadog: 'Bits Testing',
    betterstack: 'Not listed',
    browserstack: 'AI agents',
  },
  {
    name: 'k6 load testing',
    supercheck: `${catalog.plus.limits.k6VuMinutesIncluded.toLocaleString("en-US")}–${catalog.pro.limits.k6VuMinutesIncluded.toLocaleString("en-US")} VU min`,
    checkly: 'Not listed',
    datadog: 'Results only',
    betterstack: 'Not listed',
    browserstack: 'k6 and JMeter scripts',
  },
  {
    name: 'Status pages',
    supercheck: `Included, ${catalog.plus.limits.maxStatusPages}–${catalog.pro.limits.maxStatusPages} pages`,
    checkly: '$9–$30/mo',
    datadog: 'With Incident Management',
    betterstack: '1 included, extra $15/mo',
    browserstack: 'Not listed',
  },
  {
    name: 'AI incident investigation',
    supercheck: `${Number(catalog.plus.limits.sreInvestigationUnitsIncluded).toLocaleString("en-US")}–${Number(catalog.pro.limits.sreInvestigationUnitsIncluded).toLocaleString("en-US")} per month`,
    checkly: '$12–$39/mo',
    datadog: 'Bits AI credits',
    betterstack: 'Billed per token',
    browserstack: 'Not listed',
  },
  {
    name: 'Self-hostable',
    supercheck: 'Yes',
    checkly: 'SaaS only',
    datadog: 'SaaS only',
    betterstack: 'SaaS only',
    browserstack: 'Not listed',
  },
  {
    name: 'Open-source platform',
    supercheck: 'Yes, AGPLv3',
    checkly: 'No',
    datadog: 'No',
    betterstack: 'No',
    browserstack: 'No',
  },
];
