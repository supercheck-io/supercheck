import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('../../app/src/lib/billing/plan-catalog.json', import.meta.url), 'utf8'));
const page = readFileSync(new URL('../content/docs/app/admin/free-trial.mdx', import.meta.url), 'utf8');
const { durationDays, limits } = catalog.trial;

test('the free trial page states the limits in the shared plan catalog', () => {
  const expected = [
    `${durationDays}-day free trial`,
    `| Monitors | ${limits.maxMonitors}, checked at most every ${limits.minCheckIntervalMinutes} minutes |`,
    `${limits.maxStatusPages}, each with up to ${limits.maxStatusPageSubscribers} subscribers`,
    `${limits.playwrightMinutes} browser minutes in total, ${limits.runningCapacity} run at a time, ${limits.queuedCapacity} waiting`,
    `up to ${limits.k6MaxVus} virtual users for ${limits.k6MaxDurationSeconds / 60} minutes per run, ${limits.k6VuMinutes} virtual-user minutes in total`,
    `| AI SRE | ${limits.sreInvestigations} full investigations |`,
    `| AI credits | ${limits.aiCredits} |`,
    `${limits.maxTeamMembers} team members and ${limits.maxProjects} projects`,
  ];
  for (const text of expected) assert.ok(page.includes(text), `free-trial.mdx should contain: ${text}`);
});

test('the free trial page is listed in the admin navigation', () => {
  const meta = JSON.parse(readFileSync(new URL('../content/docs/app/admin/meta.json', import.meta.url), 'utf8'));
  assert.ok(meta.pages.includes('free-trial'));
});

test('the free trial page explains pause, archive and that nothing is deleted', () => {
  assert.match(page, /monitors are \*\*paused\*\*/);
  assert.match(page, /status pages are \*\*archived\*\*/);
  assert.match(page, /\*\*Nothing is deleted\.\*\*/);
});
