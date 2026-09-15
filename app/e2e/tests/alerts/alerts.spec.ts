import { expect, test } from '../../fixtures';

type Provider = {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  maskedFields: string[];
  projectId: string;
  organizationId: string;
};

test.describe('Notification providers lifecycle @alerts @channels', () => {
  let providerId: string | undefined;
  const providerName = `E2E email channel ${Date.now()}`;
  const renamedProvider = `${providerName} renamed`;
  const recipient = `alerts-${Date.now()}@e2e-test.supercheck.io`;

  test('creates, persists, renders, updates, and deletes an email channel @critical @positive', async ({ projectAdminPage, cleanup }) => {
    const request = projectAdminPage.request;
    const create = await request.post('/api/notification-providers', {
      data: { type: 'email', config: { name: providerName, emails: [recipient] } },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as Provider;
    providerId = created.id;
    cleanup.add(`notification provider ${created.id}`, async () => {
      if (!providerId) return;
      const response = await request.delete(`/api/notification-providers/${created.id}`);
      if (![200, 404].includes(response.status())) {
        throw new Error(`Notification-provider cleanup failed (${response.status()}): ${await response.text()}`);
      }
    });
    expect(created).toMatchObject({ name: providerName, type: 'email' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.projectId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.organizationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.config).toMatchObject({ name: providerName, emails: [recipient] });

    const list = await request.get('/api/notification-providers');
    expect(list.status()).toBe(200);
    const providers = (await list.json()) as Provider[];
    expect(providers.find(({ id }) => id === providerId)).toMatchObject({
      id: providerId,
      name: providerName,
      type: 'email',
    });

    await projectAdminPage.goto('/alerts');
    await projectAdminPage.getByRole('tab', { name: 'Channels' }).click();
    await expect(projectAdminPage.getByText(providerName, { exact: true })).toBeVisible();

    const update = await request.put(`/api/notification-providers/${providerId}`, {
      data: { name: renamedProvider, type: 'email' },
    });
    expect(update.status(), await update.text()).toBe(200);
    expect(await update.json()).toMatchObject({ id: providerId, name: renamedProvider, type: 'email' });

    await projectAdminPage.reload();
    await projectAdminPage.getByRole('tab', { name: 'Channels' }).click();
    await expect(projectAdminPage.getByText(renamedProvider, { exact: true })).toBeVisible();
    await expect(projectAdminPage.getByText(providerName, { exact: true })).toHaveCount(0);

    const remove = await request.delete(`/api/notification-providers/${providerId}`);
    expect(remove.status(), await remove.text()).toBe(200);
    expect(await remove.json()).toEqual({
      success: true,
      message: 'Notification provider deleted successfully',
    });
    providerId = undefined;

    const missing = await request.get(`/api/notification-providers/${created.id}`);
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Notification provider not found' });
  });

  test('rejects invalid provider configuration and private webhook targets @high @security', async ({ request }) => {
    const missingRecipient = await request.post('/api/notification-providers', {
      data: { type: 'email', config: { name: 'invalid email channel' } },
    });
    expect(missingRecipient.status()).toBe(400);
    expect(await missingRecipient.json()).toEqual({
      error: 'Email notification providers require at least one email address.',
    });

    const privateWebhook = await request.post('/api/notification-providers', {
      data: { type: 'webhook', config: { name: 'blocked webhook', url: 'http://127.0.0.1:8080/hook' } },
    });
    expect(privateWebhook.status()).toBe(400);
    expect(await privateWebhook.json()).toMatchObject({
      error: expect.stringContaining('Target URL:'),
    });
  });
});

test.describe('Notification provider authentication @alerts @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('requires authentication for list, create, update, and delete @critical @security', async ({ request }) => {
    const unknownId = '01900000-0000-7000-8000-000000000000';
    const responses = await Promise.all([
      request.get('/api/notification-providers'),
      request.post('/api/notification-providers', { data: {} }),
      request.put(`/api/notification-providers/${unknownId}`, { data: {} }),
      request.delete(`/api/notification-providers/${unknownId}`),
    ]);
    for (const response of responses) {
      expect(response.status(), await response.text()).toBe(401);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
    }
  });
});
