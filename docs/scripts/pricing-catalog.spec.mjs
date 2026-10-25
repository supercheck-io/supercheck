import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The marketing pricing page must derive plan numbers from the shared catalog
// so it cannot drift from what the app enforces and bills.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../../app/src/lib/billing/plan-catalog.json'));
const sources = {
  'pricing/page.tsx': read('../src/app/pricing/page.tsx'),
  'vendor-comparison.tsx': read('../src/components/pricing/vendor-comparison.tsx'),
  'pricing-estimate.ts': read('../src/lib/pricing-estimate.ts'),
  'pricing-data.ts': read('../src/lib/pricing-data.ts'),
};
const paidPlans = ['plus', 'pro'];

test('paid plan prices are not hardcoded', () => {
  for (const id of paidPlans) {
    const price = `$${catalog[id].monthlyPriceCents / 100}`;
    for (const [name, source] of Object.entries(sources)) {
      assert.ok(!source.includes(price), `${name} hardcodes the ${id} price ${price}`);
    }
  }
});

test('large plan allowances are not hardcoded', () => {
  for (const id of paidPlans) {
    for (const [key, value] of Object.entries(catalog[id].limits)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 1000) continue;
      const formatted = number.toLocaleString('en-US');
      for (const [name, source] of Object.entries(sources)) {
        // pricing-data.ts holds competitor figures such as "1,000 runs".
        if (name === 'pricing-data.ts') continue;
        // "per 1,000" is a rate unit, not an allowance.
        const prose = source.replaceAll(`per ${formatted}`, '');
        assert.ok(!prose.includes(formatted), `${name} hardcodes ${id}.${key} (${formatted})`);
      }
    }
  }
});

test('small plan limits are not written as literal numbers next to their unit', () => {
  const units = {
    maxMonitors: 'monitors',
    maxTeamMembers: 'team members',
    maxProjects: 'projects',
    maxStatusPages: 'status pages',
    runningCapacity: 'concurrent',
    sreInvestigationUnitsIncluded: 'AI SRE',
  };
  for (const id of paidPlans) {
    for (const [key, unit] of Object.entries(units)) {
      const value = Number(catalog[id].limits[key]).toLocaleString('en-US');
      const literal = new RegExp(`(^|[^\\w$.])${value} ${unit}`);
      for (const [name, source] of Object.entries(sources)) {
        assert.ok(!literal.test(source), `${name} hardcodes "${value} ${unit}" (${id}.${key})`);
      }
    }
  }
  for (const [name, source] of Object.entries(sources)) {
    assert.ok(!/\b\d+ concurrent\b/.test(source), `${name} hardcodes a concurrent-run count`);
  }
});

test('plan cards are built from the catalog', () => {
  const page = sources['pricing/page.tsx'];
  for (const id of paidPlans) assert.match(page, new RegExp(`planFeatures\\('${id}'`));
});
