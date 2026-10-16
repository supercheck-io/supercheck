import {
  BETTERSTACK_PER_MINUTE,
  CHECKLY_TIERS,
  DATADOG_PER_1K_RUNS,
  MINUTES_PER_MONTH,
  SUPERCHECK_PLANS,
} from './pricing-data';

export interface Workload {
  checks: number;
  intervalMinutes: number;
  durationSeconds: number;
}

export interface Estimate {
  id: string;
  name: string;
  isSupercheck: boolean;
  monthlyCost: number;
  detail: string;
}

export interface EstimateResult {
  runsPerMonth: number;
  playwrightMinutes: number;
  estimates: Estimate[];
  notices: string[];
}

const number = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return number.format(Math.round(value));
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function estimateCosts(workload: Workload): EstimateResult {
  const executionsPerCheck = MINUTES_PER_MONTH / workload.intervalMinutes;
  // Browser checks run from a single EU location, so one run per check.
  const runsPerMonth = Math.round(workload.checks * executionsPerCheck);
  const playwrightMinutes = (runsPerMonth * workload.durationSeconds) / 60;
  const notices: string[] = [];
  const estimates: Estimate[] = [];

  // Cheapest Supercheck plan that fits the monitor count.
  const supercheckOptions = SUPERCHECK_PLANS.filter(
    (plan) => workload.checks <= plan.maxMonitors,
  ).map((plan) => {
    const overageMinutes = Math.max(
      0,
      playwrightMinutes - plan.includedPlaywrightMinutes,
    );
    return {
      plan,
      overageMinutes,
      cost: plan.monthlyFee + overageMinutes * plan.overagePerMinute,
    };
  });
  const supercheck = supercheckOptions.sort((a, b) => a.cost - b.cost)[0];
  if (supercheck) {
    estimates.push({
      id: 'supercheck',
      name: `Supercheck ${supercheck.plan.name}`,
      isSupercheck: true,
      monthlyCost: supercheck.cost,
      detail:
        supercheck.overageMinutes > 0
          ? `${formatCount(supercheck.plan.includedPlaywrightMinutes)} min included + ${formatCount(supercheck.overageMinutes)} min overage`
          : `Within the ${formatCount(supercheck.plan.includedPlaywrightMinutes)} min included`,
    });
  } else {
    notices.push(
      'That many checks is above the Pro plan’s 200-monitor limit. Contact us for an Enterprise quote.',
    );
  }

  // Checkly: cheapest tier; the hard-capped Hobby tier only counts when it fits.
  const checkly = CHECKLY_TIERS.filter(
    (tier) => !tier.hardCap || runsPerMonth <= tier.includedRuns,
  )
    .map((tier) => {
      const overageRuns = Math.max(0, runsPerMonth - tier.includedRuns);
      return {
        tier,
        overageRuns,
        cost: tier.monthlyFee + (overageRuns / 1000) * tier.overagePer1kRuns,
      };
    })
    .sort((a, b) => a.cost - b.cost)[0];
  estimates.push({
    id: 'checkly',
    name: `Checkly ${checkly.tier.name}`,
    isSupercheck: false,
    monthlyCost: checkly.cost,
    detail:
      checkly.overageRuns > 0
        ? `${formatCount(checkly.tier.includedRuns)} runs included + ${formatCount(checkly.overageRuns)} runs overage`
        : `Within the ${formatCount(checkly.tier.includedRuns)} runs included`,
  });

  estimates.push({
    id: 'datadog',
    name: 'Datadog Synthetics',
    isSupercheck: false,
    monthlyCost: (runsPerMonth / 1000) * DATADOG_PER_1K_RUNS,
    detail: `${formatCount(runsPerMonth)} browser runs at $12 per 1,000`,
  });

  estimates.push({
    id: 'betterstack',
    name: 'Better Stack',
    isSupercheck: false,
    monthlyCost: playwrightMinutes * BETTERSTACK_PER_MINUTE,
    detail: `${formatCount(playwrightMinutes)} Playwright min at $1 per 100 (excludes monitor fees)`,
  });

  // Average concurrent executions if every run starts on schedule.
  const averageConcurrency =
    (workload.checks * workload.durationSeconds) /
    (workload.intervalMinutes * 60);
  if (supercheck && averageConcurrency > 5) {
    notices.push(
      `This workload averages about ${formatCount(Math.ceil(averageConcurrency))} concurrent browser runs. Plus allows 5 concurrent jobs and Pro allows 10; contact us if you need more.`,
    );
  }
  if (checkly.tier.hardCap) {
    estimates.find((e) => e.id === 'checkly')!.detail +=
      '. The free tier has its own feature and frequency limits';
  }

  estimates.sort((a, b) => a.monthlyCost - b.monthlyCost);
  return { runsPerMonth, playwrightMinutes, estimates, notices };
}
