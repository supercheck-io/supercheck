import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { createProjectSecret, deleteMonitor, deleteProjectSecret } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

test.describe('AI endpoint monitor preset @monitors', () => {
  test('creates a preset monitor with a project secret and reopens it in the preset @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const secretKey = `E2E_AI_${String(Date.now()).slice(-6)}`;
    const secret = await createProjectSecret(request, secretKey, 'sk-e2e-not-a-real-key');
    cleanup.add(`secret ${secretKey}`, () => deleteProjectSecret(request, secret.projectId, secret.id));

    const name = `E2E AI endpoint ${Date.now()}`;
    await page.goto('/monitors/create?type=http_request');
    await waitForHydration(page);

    await page.getByRole('textbox', { name: 'Title' }).fill(name);
    // Invalid plain-request headers are hidden by the preset and must not block saving.
    await page.getByPlaceholder('{ "Authorization": "Bearer ..." }').fill('not json');
    await page.getByTestId('monitor-preset').click();
    await page.getByRole('option', { name: 'AI endpoint (OpenAI-compatible)' }).click();

    await expect(page.getByTestId('ai-endpoint-fields')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Target' })).toHaveValue('https://api.openai.com/v1/chat/completions');
    await expect(page.getByTestId('ai-monthly-calls')).toContainText('about 8,640 calls a month');

    await page.getByTestId('ai-secret').click();
    await page.getByRole('option', { name: secretKey }).click();
    await page.getByTestId('ai-model').fill('gpt-4o-mini');
    await page.locator('form button[type="submit"]').click();
    // The create wizard continues to the alert settings step before saving.
    await expect(page).toHaveURL(/wizardStep=alerts/);
    await page.getByRole('button', { name: 'Create Monitor', exact: true }).click();

    await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}$/);
    const monitorId = new URL(page.url()).pathname.split('/').pop() as string;
    cleanup.add(`monitor ${monitorId}`, () => deleteMonitor(request, monitorId));

    const persisted = await request.get(`/api/monitors/${monitorId}`);
    expect(persisted.status()).toBe(200);
    const monitor = (await persisted.json()) as {
      frequencyMinutes: number;
      config: { aiEndpoint: Record<string, unknown>; method?: string };
      alertConfig?: { failureThreshold?: number };
    };
    expect(monitor.frequencyMinutes).toBe(5);
    // The preset alerts after 2 failures, carried through the wizard's alert step.
    expect(monitor.alertConfig?.failureThreshold).toBe(2);
    expect(monitor.config.aiEndpoint).toMatchObject({ model: 'gpt-4o-mini', secretKey });
    expect(monitor.config.method).toBeUndefined();

    await expect(page.getByTestId('monitor-ai-subtitle')).toContainText('api.openai.com · gpt-4o-mini');

    await page.goto(`/monitors/${monitorId}/edit`);
    await waitForHydration(page);
    await expect(page.getByTestId('monitor-preset')).toContainText('AI endpoint (OpenAI-compatible)');
    await expect(page.getByTestId('ai-model')).toHaveValue('gpt-4o-mini');
  });

  test('saving without a model shows the field error and creates nothing @high @negative', async ({ projectAdminPage: page }) => {
    const created: string[] = [];
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/monitors') created.push(response.url());
    });
    await page.goto('/monitors/create?type=http_request');
    await waitForHydration(page);

    await page.getByRole('textbox', { name: 'Title' }).fill(`E2E AI no model ${Date.now()}`);
    await page.getByTestId('monitor-preset').click();
    await page.getByRole('option', { name: 'AI endpoint (OpenAI-compatible)' }).click();
    await page.getByTestId('ai-no-key').click();
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText('Model is required')).toBeVisible();
    await expect(page).toHaveURL(/\/monitors\/create/);
    expect(created).toHaveLength(0);
  });
});
