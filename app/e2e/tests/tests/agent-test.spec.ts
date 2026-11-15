import { expect, type APIRequestContext } from '@playwright/test';
import { test } from '../../fixtures';
import { createTest, deleteTest } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';
import { startAgentStub } from '../../utils/agent-stub-server';

// The worker, not the browser, calls the agent, so the stub must be reachable from the worker. Set
// E2E_AGENT_STUB_URL to the host the worker sees (for example http://host.docker.internal), without a port, and
// run the app and worker with ALLOW_INTERNAL_TARGETS=true. The worker image must include @supercheck/agent-test.
const stubUrl = process.env.E2E_AGENT_STUB_URL;
const SKIP_REASON = 'Set E2E_AGENT_STUB_URL (and ALLOW_INTERNAL_TARGETS=true on the app and worker) to reach the stub agent';

async function runAndWait(request: APIRequestContext, testId: string) {
  const projectId = ((await (await request.get('/api/projects')).json()) as { currentProject?: { id?: string } }).currentProject?.id as string;
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const headers = { Origin: origin, Referer: `${origin}/tests`, 'x-project-id': projectId };
  const start = await request.post(`/api/tests/${testId}/execute`, { headers, data: {} });
  expect(start.status(), await start.text()).toBe(200);
  const { runId } = (await start.json()) as { runId: string };
  await expect
    .poll(async () => ((await (await request.get(`/api/runs/${runId}`)).json()) as { status: string }).status, { timeout: 240_000 })
    .toMatch(/^(passed|failed)$/);
  return runId;
}

const script = (url: string, prompt: string, expected: string) =>
  Buffer.from(`import { test, expect } from '@supercheck/agent-test';

test('stub agent', async ({ agent }) => {
  const bot = agent.connect({ kind: 'openai', url: '${url}', model: 'e2e-agent' });
  const result = await agent.repeat(3, async () => {
    const run = await bot.send('${prompt}');
    expect(run.text).toContain('${expected}');
  });
  expect(result.passRate).toBeGreaterThanOrEqual(0.8);
});
`).toString('base64');

test.describe('Agent test @tests', () => {
  test('Quick Create offers the Agent test and opens the Playground on it @high @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/create');
    await waitForHydration(page);
    await page.getByRole('button', { name: /Agent/ }).click();
    await expect(page).toHaveURL(/\/playground\?scriptType=agent/);
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test.describe('against a stub agent', () => {
    test.skip(!stubUrl, SKIP_REASON);

    test('shows pass rate and tools on the run page @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
      const request = page.request;
      const stub = await startAgentStub();
      cleanup.add('agent stub', () => stub.close());
      const created = await createTest(request, {
        title: `E2E agent pass ${Date.now()}`,
        type: 'agent',
        script: script(`${stubUrl}:${stub.port}/v1/chat/completions`, 'What is the refund policy?', '30 days'),
      });
      cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));

      const runId = await runAndWait(request, created.id);
      cleanup.add(`run ${runId}`, async () => { await request.delete(`/api/runs/${runId}`); });
      expect(stub.requests()).toBeGreaterThan(0);

      await page.goto(`/runs/${runId}`);
      const card = page.getByTestId('agent-results-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText('100%')).toBeVisible();
      await expect(card.getByText('3 of 3 passed')).toBeVisible();
      await expect(card.getByText('lookup_policy')).toBeVisible();
    });

    test('a failing assertion shows a failed run with the failure list @high @negative', async ({ projectAdminPage: page, cleanup }) => {
      const request = page.request;
      const stub = await startAgentStub();
      cleanup.add('agent stub', () => stub.close());
      const created = await createTest(request, {
        title: `E2E agent fail ${Date.now()}`,
        type: 'agent',
        script: script(`${stubUrl}:${stub.port}/v1/chat/completions`, 'What is the weather?', '30 days'),
      });
      cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));

      const runId = await runAndWait(request, created.id);
      cleanup.add(`run ${runId}`, async () => { await request.delete(`/api/runs/${runId}`); });
      expect(((await (await request.get(`/api/runs/${runId}`)).json()) as { status: string }).status).toBe('failed');

      await page.goto(`/runs/${runId}`);
      const card = page.getByTestId('agent-results-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText('0%')).toBeVisible();
      await expect(card.getByTestId('agent-results-failures')).toContainText('Attempt 1');
    });
  });
});
