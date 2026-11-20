import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { isTestRecord, OUT_DIR } from './lib';
import { createJob, createMonitor, createTest } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

/**
 * Fills the gaps the docs shots need in the showcase project, through the app's own API and UI.
 * Each step creates its record only when the project has none, so repeated runs add nothing but
 * fresh heartbeat pings. Names read like a real team's setup, not test data.
 */

type Row = { id?: string; type?: string; name?: string; title?: string; jobType?: string };
/** A failed read is not proof that a record is missing, so it throws (failing only its own seed step). */
const list = async (api: APIRequestContext, url: string, key: string): Promise<Row[]> => {
  const response = await api.get(url);
  if (!response.ok()) throw new Error(`${url} returned ${response.status()}`);
  return ((await response.json()) as Record<string, Row[]>)[key] ?? [];
};

/** A run of the nightly job: /start, then the finishing ping, so the detail page shows a duration. */
async function pingHeartbeat(api: APIRequestContext, baseUrl: string, monitors: Row[]): Promise<void> {
  const heartbeat = monitors.find((m) => m.type === 'heartbeat');
  if (!heartbeat?.id) return;
  const reveal = await api.get(`/api/monitors/${heartbeat.id}/heartbeat-url`, { headers: { origin: baseUrl } });
  expect(reveal.ok(), `revealing the heartbeat URL returned ${reveal.status()}`).toBe(true);
  const { pingUrl } = (await reveal.json()) as { pingUrl: string };
  // Pings come from the job's crontab, so they carry curl's user agent like a real one would.
  const curl = { headers: { 'user-agent': 'curl/8.5.0' } };
  expect((await api.get(`${pingUrl}/start`, curl)).ok()).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  expect((await api.get(pingUrl, curl)).ok()).toBe(true);
}

/** A public, unauthenticated MCP server, so the monitor lists real tools without a stored key. */
async function ensureMcpMonitor(api: APIRequestContext, monitors: Row[]): Promise<void> {
  if (monitors.some((m) => m.type === 'mcp_server')) return;
  const { id } = await createMonitor(api, {
    name: 'Docs search MCP server',
    type: 'mcp_server',
    target: 'https://mcp.deepwiki.com/mcp',
    frequencyMinutes: 10,
    config: { mcp: { auth: { type: 'none' } } },
  });
  // The first check runs at once; the detail shot needs its tool list.
  await expect
    .poll(async () => (await list(api, `/api/monitors/${id}/results?limit=1`, 'data')).length, { timeout: 90_000 })
    .toBeGreaterThan(0);
}

const AGENT_SCRIPT = `import { test, expect } from '@supercheck/agent-test';

test('support bot answers the refund window', async ({ agent }) => {
  const bot = agent.connect({ kind: 'openai', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' });
  const result = await agent.repeat(5, async () => {
    const run = await bot.send('How long do I have to return a jacket I bought online?');
    expect(run.text).toContain('30 days');
  });
  expect(result.passRate).toBeGreaterThanOrEqual(0.8);
});
`;

async function ensureAgentTest(api: APIRequestContext): Promise<void> {
  if ((await list(api, '/api/tests?limit=100', 'data')).some((t) => t.type === 'agent')) return;
  await createTest(api, {
    title: 'Support bot: refund policy answers',
    description: 'Asks the storefront support bot about returns five times and expects the 30-day window.',
    type: 'agent',
    script: Buffer.from(AGENT_SCRIPT).toString('base64'),
  });
}

async function ensureService(page: Page, services: Row[]): Promise<void> {
  if (services.length) return;
  await page.goto('/services', { waitUntil: 'load' });
  await waitForHydration(page);
  await page.getByTestId('add-service-btn').filter({ visible: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add service' });
  await dialog.getByLabel('Title *').fill('Checkout API');
  await dialog.getByLabel('Environment').fill('production');
  await dialog.getByLabel('Description').fill('Cart, pricing and payment handoff for the storefront.');
  await dialog.getByTestId('submit-service-btn').click();
  await expect(dialog).toBeHidden();
}

/** A resolved public status update, so the public page's past incidents link to an incident page. */
async function ensurePublicIncident(page: Page, statusPageId: string | undefined): Promise<void> {
  if (!statusPageId) return;
  await page.goto(`/status-pages/${statusPageId}/public`, { waitUntil: 'load' });
  if (await page.locator('a[href*="/incidents/"]').first().isVisible().catch(() => false)) return;
  await page.goto(`/status-pages/${statusPageId}`, { waitUntil: 'load' });
  await waitForHydration(page);
  await page.getByRole('tab', { name: 'Status updates', exact: true }).click();
  await page.getByRole('button', { name: 'New status update', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New status update' });
  await dialog.getByLabel('Title *').fill('Delayed order confirmation emails');
  await dialog
    .getByLabel('Initial Message *')
    .fill('Order confirmation emails are arriving up to 20 minutes late. Orders and payments are not affected. We are working with our email provider.');
  // The form needs one affected component; a page without components gets no seeded update.
  const component = dialog.locator('button[id^="component-"]').first();
  if (!(await component.isVisible().catch(() => false))) {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    return;
  }
  await component.click();
  // Post it as already resolved, so seeding never leaves a live outage or changes a component's health.
  await dialog.locator('#incident-status').click();
  await page.getByRole('option', { name: 'Resolved' }).click();
  await dialog.locator('#incident-component-status').click();
  await page.getByRole('option', { name: 'Operational' }).click();
  // Seeding must never email subscribers.
  const notify = dialog.locator('#incident-notify');
  if ((await notify.getAttribute('data-state')) === 'checked') await notify.click();
  await expect(notify).toHaveAttribute('data-state', 'unchecked');
  await dialog.getByRole('button', { name: 'Post status update', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** k6 analytics compare needs a k6 job with at least two finished runs; one-off playground runs do not count. */
async function ensureK6Job(api: APIRequestContext, baseUrl: string): Promise<void> {
  const k6Test = (await list(api, '/api/tests?limit=100', 'data')).find((t) => t.type === 'performance' || t.type === 'k6');
  if (!k6Test?.id) return;
  // Reuse an existing k6 job, so an interrupted first seed resumes instead of being skipped forever.
  const existing = (await list(api, '/api/jobs', 'data')).find((j) => j.jobType === 'k6' && !isTestRecord(j));
  const jobId = existing?.id ?? (await createJob(api, { name: 'Checkout load check', jobType: 'k6', testId: k6Test.id, tests: [{ id: k6Test.id }] })).id;
  // Analytics defaults to 30 days, so count only runs that finished inside it.
  const since = Date.now() - 29 * 24 * 60 * 60 * 1000;
  const runs = (await list(api, `/api/runs?jobId=${jobId}&limit=20`, 'data')) as Array<Row & { status?: string; completedAt?: string }>;
  const finished = runs.filter((r) => /^(passed|failed)$/.test(r.status ?? '') && r.completedAt && Date.parse(r.completedAt) > since).length;
  for (let i = finished; i < 2; i++) {
    const start = await api.post('/api/jobs/run', {
      headers: { origin: baseUrl },
      data: { jobId, tests: [{ id: k6Test.id, name: k6Test.title ?? '', title: k6Test.title ?? '' }], trigger: 'manual' },
    });
    expect(start.ok(), `starting the k6 job returned ${start.status()}`).toBe(true);
    const { runId } = (await start.json()) as { runId: string };
    // One k6 run at a time, so wait for each before starting the next.
    await expect
      .poll(async () => ((await (await api.get(`/api/runs/${runId}`)).json()) as { status?: string }).status, { timeout: 300_000, intervals: [5_000] })
      .toMatch(/^(passed|failed|error)$/);
  }
}

/** A resolved incident with a real-looking story, so the workspace, brief and post-mortem shots show production data. */
async function ensureResolvedIncident(api: APIRequestContext, baseUrl: string): Promise<void> {
  const incidents = (await list(api, '/api/sre/incidents', 'incidents')) as Array<Row & { status?: string }>;
  if (incidents.some((i) => i.status === 'resolved' && !isTestRecord(i))) return;
  const services = await list(api, '/api/sre/services', 'services');
  const created = await api.post('/api/sre/incidents', {
    headers: { origin: baseUrl },
    data: {
      title: 'Checkout API returning 502s after the 14:05 deploy',
      severity: 'sev2',
      summary: 'Roughly 8% of checkout requests failed with 502 for 18 minutes after release 2026.11.20-3. Payment capture was not affected; customers saw a retry prompt.',
      ...(services[0]?.id ? { primaryServiceId: services[0].id } : {}),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { incident } = (await created.json()) as { incident: { id: string } };
  const resolved = await api.post(`/api/sre/incidents/${incident.id}/resolve`, {
    headers: { origin: baseUrl },
    data: { resolutionSummary: 'Rolled back to 2026.11.20-2. A connection pool limit in the new release capped upstream connections; fixed and redeployed with the limit raised.' },
  });
  expect(resolved.ok(), await resolved.text()).toBe(true);
}

export async function seedShowcase(page: Page, baseUrl: string): Promise<void> {
  // A failed shot restarts the worker, which would seed again; once per capture run is enough.
  const marker = path.join(OUT_DIR, '.showcase-seeded');
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString());
  const api = page.request;
  const [monitors, services, pages] = await Promise.all([
    list(api, '/api/monitors', 'data'),
    list(api, '/api/sre/services', 'services'),
    list(api, '/api/status-pages', 'data'),
  ]);
  // One failed step must not cost every shot: its own shot fails instead, with the reason logged here.
  const step = (name: string, run: () => Promise<void>) =>
    run().catch((error: unknown) => console.warn(`showcase seed: ${name} failed: ${error instanceof Error ? error.message : String(error)}`));
  await step('heartbeat pings', () => pingHeartbeat(api, baseUrl, monitors));
  await step('agent test', () => ensureAgentTest(api));
  await step('MCP monitor', () => ensureMcpMonitor(api, monitors));
  await step('AI SRE service', () => ensureService(page, services));
  await step('public status update', () => ensurePublicIncident(page, pages[0]?.id));
  await step('resolved incident', () => ensureResolvedIncident(api, baseUrl));
  await step('k6 job runs', () => ensureK6Job(api, baseUrl));
}
