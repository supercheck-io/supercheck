import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../../app/src/lib/billing/plan-catalog.json' with { type: 'json' };
import { estimateCosts, planCrossoverMinutes } from '../src/lib/pricing-estimate';

const plus = catalog.plus;
const pro = catalog.pro;

test('rounds each run to four decimal minutes, like billing', () => {
  // Five 5-second checks every 5 minutes over 30 days: 43,200 runs at 0.0833 min.
  const result = estimateCosts({ checks: 5, intervalMinutes: 5, durationSeconds: 5 });
  assert.equal(result.runsPerMonth, 43_200);
  assert.equal(Number(result.playwrightMinutes.toFixed(2)), 3_598.56);
  const supercheck = result.estimates.find((estimate) => estimate.isSupercheck);
  const overage = 3_598.56 - plus.limits.playwrightMinutesIncluded;
  assert.equal(
    Number(supercheck?.monthlyCost.toFixed(2)),
    Number((plus.monthlyPriceCents / 100 + overage * (plus.overageCents.playwrightMinutes / 100)).toFixed(2)),
  );
});

test('Plus and Pro cost the same at the crossover', () => {
  const minutes = planCrossoverMinutes();
  const cost = (plan: typeof plus) =>
    plan.monthlyPriceCents / 100 +
    Math.max(0, minutes - plan.limits.playwrightMinutesIncluded) * (plan.overageCents.playwrightMinutes / 100);
  assert.ok(Math.abs(cost(plus) - cost(pro)) < 0.01);
});

test('picks Pro when the monitor count exceeds Plus', () => {
  const result = estimateCosts({ checks: plus.limits.maxMonitors + 1, intervalMinutes: 60, durationSeconds: 5 });
  assert.equal(result.estimates.find((estimate) => estimate.isSupercheck)?.name, `Supercheck ${pro.name}`);
});
