import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { createMonitor, deleteMonitor } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';
import { startAgentStub } from '../../utils/agent-stub-server';
import { ENV_GATED } from '../../reporters/priority-skip-reporter';

// The worker calls the stub (non-streamed OpenAI reply, model e2e-agent, 10 + 8 tokens), so it must reach it.
// Same gate as the agent test: E2E_AGENT_STUB_URL is the host the worker sees, without a port, and the app and
// worker run with ALLOW_INTERNAL_TARGETS=true.
const stubUrl = process.env.E2E_AGENT_STUB_URL;
const SKIP_REASON = 'Set E2E_AGENT_STUB_URL (and ALLOW_INTERNAL_TARGETS=true on the app and worker) to reach the stub endpoint';

test.describe('AI endpoint monitor detail @monitors', () => {
  test('the AI details popover shows the requested model before any check and the header keeps three metric groups @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    // Disabled: no check ever runs, so the popover is in its pending state.
    const { id } = await createMonitor(request, {
      name: `E2E AI detail pending ${Date.now()}`,
      target: 'https://api.openai.com/v1/chat/completions',
      enabled: false,
      config: { aiEndpoint: { model: 'e2e-requested-model' } },
    });
    cleanup.add(`monitor ${id}`, () => deleteMonitor(request, id));

    await page.goto(`/monitors/${id}`);
    await waitForHydration(page);

    // The AI numbers live behind the button, so the header keeps Current, Last 24 hours and Last 30 days.
    const header = page.getByTestId('monitor-detail-header');
    for (const title of ['Current', 'Last 24 hours', 'Last 30 days']) {
      await expect(header.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('ai-stat-first-token')).toHaveCount(0);

    await page.getByTestId('ai-endpoint-button').click();
    const panel = page.getByTestId('ai-endpoint-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Shown after the first check.');
    await expect(panel.getByTestId('ai-stat-requested-model')).toContainText('e2e-requested-model');
    await expect(panel.getByTestId('ai-stat-first-token')).toContainText('—');
    await expect(panel.getByTestId('ai-stat-served-model')).toContainText('—');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test.describe('with a stub endpoint', { annotation: { type: ENV_GATED, description: SKIP_REASON } }, () => {
    test.skip(!stubUrl, SKIP_REASON);

    test('the AI details popover shows first token, tokens, requested and served model after a check @high @positive @execution', async ({ projectAdminPage: page, cleanup }) => {
      test.setTimeout(3 * 60_000);
      const request = page.request;
      const stub = await startAgentStub();
      cleanup.add('agent stub', () => stub.close());
      const { id } = await createMonitor(request, {
        name: `E2E AI detail ${Date.now()}`,
        target: `${stubUrl}:${stub.port}/v1/chat/completions`,
        config: { aiEndpoint: { model: 'e2e-requested-model' } },
      });
      cleanup.add(`monitor ${id}`, () => deleteMonitor(request, id));

      // The first check fires on create; reload until the worker has stored it.
      await expect(async () => {
        await page.goto(`/monitors/${id}`);
        await waitForHydration(page);
        await page.getByTestId('ai-endpoint-button').click();
        await expect(page.getByTestId('ai-stat-served-model')).toContainText('e2e-agent', { timeout: 2_000 });
      }).toPass({ timeout: 120_000 });

      const panel = page.getByTestId('ai-endpoint-panel');
      await expect(panel.getByTestId('ai-stat-requested-model')).toContainText('e2e-requested-model');
      await expect(panel.getByTestId('ai-stat-tokens')).toContainText('18');
      await expect(panel.getByTestId('ai-stat-token-split')).toContainText('10 / 8');
      await expect(panel.getByTestId('ai-stat-first-token')).not.toContainText('—');
      expect(stub.requests()).toBeGreaterThan(0);
    });
  });
});
