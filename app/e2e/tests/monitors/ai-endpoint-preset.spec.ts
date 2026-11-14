import { expect, type APIRequestContext } from '@playwright/test';
import { test } from '../../fixtures';
import { deleteMonitor } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';

async function currentProjectId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/projects');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { currentProject?: { id?: string } | null; data?: Array<{ id?: string }> };
  const id = body.currentProject?.id ?? body.data?.[0]?.id;
  if (!id) throw new Error('E2E account has no active project');
  return id;
}

test.describe('AI endpoint monitor preset @monitors', () => {
  test('creates a preset monitor with a project secret and reopens it in the preset @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const projectId = await currentProjectId(request);
    const secretKey = `E2E_AI_${String(Date.now()).slice(-6)}`;
    const created = await request.post(`/api/projects/${projectId}/variables`, {
      data: { key: secretKey, value: 'sk-e2e-not-a-real-key', isSecret: true },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const variableId = ((await created.json()) as { data?: { id?: string }; id?: string }).data?.id;
    cleanup.add(`secret ${secretKey}`, async () => {
      if (variableId) await request.delete(`/api/projects/${projectId}/variables/${variableId}`);
    });

    const name = `E2E AI endpoint ${Date.now()}`;
    await page.goto('/monitors/create?type=http_request');
    await waitForHydration(page);

    await page.getByRole('textbox', { name: 'Title' }).fill(name);
    await page.getByTestId('monitor-preset').click();
    await page.getByRole('option', { name: 'AI endpoint (OpenAI-compatible)' }).click();

    await expect(page.getByTestId('ai-endpoint-fields')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Target' })).toHaveValue('https://api.openai.com/v1/chat/completions');
    await expect(page.getByTestId('ai-monthly-calls')).toContainText('about 8,640 calls a month');

    await page.getByTestId('ai-secret').click();
    await page.getByRole('option', { name: secretKey }).click();
    await page.getByTestId('ai-model').fill('gpt-4o-mini');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}$/);
    const monitorId = new URL(page.url()).pathname.split('/').pop() as string;
    cleanup.add(`monitor ${monitorId}`, () => deleteMonitor(request, monitorId));

    const persisted = await request.get(`/api/monitors/${monitorId}`);
    expect(persisted.status()).toBe(200);
    const monitor = (await persisted.json()) as { frequencyMinutes: number; config: { aiEndpoint: Record<string, unknown>; method?: string } };
    expect(monitor.frequencyMinutes).toBe(5);
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
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('Model is required')).toBeVisible();
    await expect(page).toHaveURL(/\/monitors\/create/);
    expect(created).toHaveLength(0);
  });
});
