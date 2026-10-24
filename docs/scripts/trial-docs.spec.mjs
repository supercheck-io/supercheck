import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../../app/src/lib/billing/plan-catalog.json'));
const pricingPage = read('../src/app/pricing/page.tsx');

test('the trial is explained on the pricing page only, not as a docs page', () => {
  assert.ok(!existsSync(new URL('../content/docs/app/admin/free-trial.mdx', import.meta.url)));
  assert.ok(!JSON.parse(read('../content/docs/app/admin/meta.json')).pages.includes('free-trial'));
});

test('the docs pricing page takes its trial text from the shared plan catalog', () => {
  assert.match(pricingPage, /from '\.\.\/\.\.\/\.\.\/\.\.\/app\/src\/lib\/billing\/trial-copy'/);
  assert.match(pricingPage, /\.\.\.trialFaqs\(\)/);
  assert.match(pricingPage, /trialHighlights\(\)/);
  assert.ok(!/Is there a free trial\?/.test(pricingPage), 'trial questions come from catalog.trial.faqs');
});

test('every placeholder in the trial FAQs names a trial limit', () => {
  const known = new Set([...Object.keys(catalog.trial.limits), 'durationDays', 'k6MaxDurationMinutes']);
  assert.ok(catalog.trial.faqs.length >= 3);
  for (const { answer } of catalog.trial.faqs) {
    for (const [, name] of answer.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(name), `unknown placeholder {${name}}`);
  }
});

test('self-hosting carries no trial settings', () => {
  assert.ok(!/TRIAL_/.test(read('../../app/.env.example')));
  const composeDir = new URL('../../deploy/docker/', import.meta.url);
  for (const file of readdirSync(composeDir).filter((name) => /\.ya?ml$/.test(name))) {
    assert.ok(!/TRIAL_/.test(readFileSync(new URL(file, composeDir), 'utf8')), `${file} must not mention trial settings`);
  }
});
