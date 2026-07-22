import { expect } from '@playwright/test';
import { test } from '../../fixtures';

test.describe('Recorder web integration @recorder', () => {
  test('Playground gives an exact install path when the Recorder extension is absent @high @positive', async ({
    page,
  }) => {
    await page.goto('/playground?scriptType=browser', { waitUntil: 'load' });
    const recordButton = page.getByRole('button', { name: 'Start Recording' });
    await expect(recordButton).toBeVisible();
    await recordButton.click();

    const dialog = page.getByRole('dialog', { name: 'Install Supercheck Recorder' });
    await expect(dialog).toBeVisible();
    const installLink = dialog.getByRole('link', { name: 'Install for Chrome' });
    await expect(installLink).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe',
    );
    await expect(installLink).toHaveAttribute('target', '_blank');
    await expect(installLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('Recorder extension credential lifecycle is scoped, one-time, and revocable @high @security', async ({
    request,
    cleanup,
  }) => {
    const revoke = async (): Promise<void> => {
      const response = await request.delete('/api/extension/auth');
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: { keysRevoked: expect.any(Number) },
      });
    };

    await revoke();
    cleanup.add('Recorder extension API key', revoke);

    const createResponse = await request.post('/api/extension/auth', {
      data: {
        name: 'E2E Recorder Credential Name Longer Than Thirty Two Characters',
        extensionVersion: 'e2e-1.0.0',
      },
    });
    const createText = await createResponse.text();
    expect(createResponse.status(), createText).toBe(200);
    const created = JSON.parse(createText) as {
      success: boolean;
      data: { apiKey: string; keyId: string; user: { id: string; email: string; name: string } };
    };
    expect(created).toMatchObject({
      success: true,
      data: {
        apiKey: expect.any(String),
        keyId: expect.any(String),
        user: {
          id: expect.any(String),
          email: expect.stringContaining('@'),
          name: expect.any(String),
        },
      },
    });

    const repeatResponse = await request.post('/api/extension/auth', { data: {} });
    expect(repeatResponse.status()).toBe(200);
    const repeated = (await repeatResponse.json()) as {
      success: boolean;
      data: { message: string; keyId: string; apiKey?: string };
    };
    expect(repeated).toMatchObject({
      success: true,
      data: { message: 'Extension already connected', keyId: created.data.keyId },
    });
    expect(repeated.data).not.toHaveProperty('apiKey');
    expect(JSON.stringify(repeated)).not.toContain(created.data.apiKey);

    const revokeResponse = await request.delete('/api/extension/auth');
    expect(revokeResponse.status()).toBe(200);
    expect(await revokeResponse.json()).toMatchObject({
      success: true,
      data: { keysRevoked: 1 },
    });
  });

  test('Recorder credential endpoint rejects unauthenticated creation and revocation @high @security', async ({
    playwright,
  }) => {
    const unauthenticated = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const method of ['post', 'delete'] as const) {
        const response = await unauthenticated[method]('/api/extension/auth', {
          data: method === 'post' ? {} : undefined,
        });
        expect(response.status()).toBe(401);
        expect(await response.json()).toEqual({
          success: false,
          error: 'Authentication required',
        });
      }
    } finally {
      await unauthenticated.dispose();
    }
  });
});
