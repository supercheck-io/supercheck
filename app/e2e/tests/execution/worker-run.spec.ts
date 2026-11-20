import { expect, type APIRequestContext } from '@playwright/test';
import { test, type CleanupRegistry } from '../../fixtures';
import { NO_WORKER, NO_WORKER_REASON } from '../../fixtures/checkpoint.fixture';
import { createTest, deleteTest } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

// Needs no network: the page is built in the browser, so a run proves the worker, the Kubernetes Job and the
// browser inside it work, and a failure is the test's own assertion, not an unreachable site.
const passing = `import { test, expect } from '@playwright/test';
test('renders a heading', async ({ page }) => {
  await page.setContent('<h1>Worker E2E</h1>');
  await expect(page.locator('h1')).toHaveText('Worker E2E');
});`;
const failing = `import { test, expect } from '@playwright/test';
test('expects a heading that is not there', async ({ page }) => {
  await page.setContent('<h1>Worker E2E</h1>');
  await expect(page.locator('h1')).toHaveText('Another heading', { timeout: 2000 });
});`;

async function runToTerminal(request: APIRequestContext, cleanup: CleanupRegistry, script: string, label: string) {
  const projectId = ((await (await request.get('/api/projects')).json()) as { currentProject: { id: string } }).currentProject.id;
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const created = await createTest(request, {
    title: `E2E worker ${label} ${Date.now()}`,
    type: 'browser',
    script: Buffer.from(script).toString('base64'),
  });
  cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));
  const start = await request.post(`/api/tests/${created.id}/execute`, {
    headers: { Origin: origin, Referer: `${origin}/tests`, 'x-project-id': projectId },
    data: {},
  });
  expect(start.status(), await start.text()).toBe(200);
  const { runId } = (await start.json()) as { runId: string };
  cleanup.add(`run ${runId}`, () =>
    expect(async () => {
      // 404: already gone. Anything else (a 500 from artifact cleanup, a 409 while still stopping) is retried, then fails.
      expect([200, 404]).toContain((await request.delete(`/api/runs/${runId}`)).status());
    }).toPass({ timeout: 30_000 }),
  );
  // The first run waits for the worker to schedule the Job and start its browser.
  let run: { status: string; errorDetails?: string | null} = { status: 'queued' };
  await expect
    .poll(
      async () => {
        run = (await (await request.get(`/api/runs/${runId}`, { headers: { 'x-project-id': projectId } })).json()) as typeof run;
        return run.status;
      },
      { timeout: 240_000, message: `run ${runId} never finished` },
    )
    .toMatch(/^(passed|failed|error)$/);
  return { runId, run };
}

test.describe('Worker execution @execution', () => {
  test.skip(NO_WORKER, NO_WORKER_REASON);
  // The poll below waits up to 240 s for the first Job to start its browser.
  test.setTimeout(300_000);

  test('a Playwright test runs through the worker and the run shows passed @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const { runId, run } = await runToTerminal(page.request, cleanup, passing, 'pass');
    expect(run.status, run.errorDetails ?? '').toBe('passed');

    await page.goto(`/runs/${runId}`);
    await waitForHydration(page);
    await expect(page.getByText('Passed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('a test with a known failure shows a failed run @critical @negative', async ({ projectAdminPage: page, cleanup }) => {
    const { runId, run } = await runToTerminal(page.request, cleanup, failing, 'fail');
    // The worker also records its own errors (a Job or browser that never started) as "failed", but with their own
    // message. Playwright's "1 failed" summary means the test ran and its assertion did not hold.
    expect(run.status, run.errorDetails ?? '').toBe('failed');
    expect(run.errorDetails).toMatch(/^1 failed\b/);

    await page.goto(`/runs/${runId}`);
    await waitForHydration(page);
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });
});
