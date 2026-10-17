// Pricing inputs for the public pricing page and cost calculator.
//
// Supercheck figures mirror app/src/lib/billing/pricing-defaults.ts and
// migration 0027_competitive_cloud_pricing.sql; update them together.
// Competitor figures come from each vendor's public pricing page. They change,
// so every entry carries the page it came from and the date we last checked.

export const COMPETITOR_AS_OF = 'October 2026';

export const MINUTES_PER_MONTH = 30 * 24 * 60;

export interface SupercheckPlanCost {
  id: 'plus' | 'pro';
  name: string;
  monthlyFee: number;
  includedPlaywrightMinutes: number;
  overagePerMinute: number;
  maxMonitors: number;
}

export const SUPERCHECK_PLANS: readonly SupercheckPlanCost[] = [
  {
    id: 'plus',
    name: 'Plus',
    monthlyFee: 49,
    includedPlaywrightMinutes: 3_000,
    overagePerMinute: 0.01,
    maxMonitors: 50,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyFee: 149,
    includedPlaywrightMinutes: 10_000,
    overagePerMinute: 0.005,
    maxMonitors: 200,
  },
];

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
  sourceUrl: string;
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
    sourceUrl: 'https://www.checklyhq.com/pricing/',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Browser checks bill one run per execution; Playwright Check Suites bill one run per 30 seconds, so we price classic browser checks. Plans shown at annual-billing rates.',
    note: 'Hobby stops at 1,000 runs. Starter and Team bill $6.50 and $6.25 per 1,000 runs beyond the allowance.',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    sourceUrl: 'https://www.datadoghq.com/pricing/?product=synthetic-monitoring',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Browser tests bill per run at $12 per 1,000 on annual billing ($18 on-demand). One run covers up to 25 steps.',
    note: 'No base fee shown for this product; other Datadog products are priced separately.',
  },
  {
    id: 'betterstack',
    name: 'Better Stack',
    sourceUrl: 'https://betterstack.com/pricing',
    asOf: COMPETITOR_AS_OF,
    billing: 'Playwright minutes are $1 per 100 minutes.',
    note: 'Monitors, responders, and extra status pages are billed separately and are not included in this estimate.',
  },
  {
    id: 'browserstack',
    name: 'BrowserStack',
    sourceUrl: 'https://www.browserstack.com/pricing?product=automate',
    asOf: COMPETITOR_AS_OF,
    billing:
      'Automate bills per parallel test with unlimited testing minutes. Plans run from $59 to $225 a month on annual billing, each for 1 parallel test.',
    note: 'Prices for 2 or more parallel tests are not published. The pages we reviewed describe running tests from your CI or code, not a built-in scheduler, so BrowserStack is shown for reference and is not part of the cost ranking.',
  },
];

// Lowest published Automate price: 1 parallel test, annual billing.
export const BROWSERSTACK_AUTOMATE_FROM_PER_MONTH = 59;

// What each vendor sells, from the same public pricing pages. "Not listed"
// means the vendor's pricing page names no such product; it is not a claim
// that the capability is impossible to assemble from other tools.
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
    supercheck: '5–10 at once, extra runs queue',
    checkly: 'Not listed',
    datadog: 'Add-on, from $79/mo',
    betterstack: 'Not listed',
    browserstack: 'Billed per parallel test',
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
    supercheck: '30,000–100,000 VU min',
    checkly: 'Not listed',
    datadog: 'Results only',
    betterstack: 'Not listed',
    browserstack: 'k6 and JMeter scripts',
  },
  {
    name: 'Status pages',
    supercheck: 'Included, 5–20 pages',
    checkly: '$9–$30/mo',
    datadog: 'With Incident Management',
    betterstack: '1 included, extra $15/mo',
    browserstack: 'Not listed',
  },
  {
    name: 'AI incident investigation',
    supercheck: '200–1,000 per month',
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
