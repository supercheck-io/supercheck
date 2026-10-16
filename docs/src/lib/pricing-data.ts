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
  id: 'checkly' | 'datadog' | 'betterstack';
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
      'Browser checks bill one run per execution, and each location counts as a run. Plans shown at annual-billing rates.',
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
    note: 'Monitors, responders, and status pages are billed separately and are not included in this estimate.',
  },
];
