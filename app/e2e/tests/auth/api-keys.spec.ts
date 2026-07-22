import { expect } from '@playwright/test';
import { test } from '../../fixtures';

type CliToken = {
  id: string;
  name: string;
  key: string;
  start: string;
  enabled: boolean;
};

type ProjectVariable = {
  id: string;
  key: string;
  value?: string;
  encryptedValue?: string;
  isSecret: boolean;
  type: 'variable' | 'secret' | 'file';
};

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

test.describe('CLI tokens and project variables @auth @security', () => {
  test('CLI token lifecycle authenticates read-only project config and never re-exposes plaintext @high @security', async ({
    projectAdminPage,
    playwright,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const suffix = uniqueSuffix();
    const originalName = `E2E CLI ${suffix}`;
    const renamedName = `${originalName} renamed`;

    const createResponse = await request.post('/api/cli-tokens', {
      data: { name: originalName, expiresIn: 3600 },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { success: boolean; token: CliToken };
    expect(created.success).toBe(true);
    expect(created.token).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: originalName,
        key: expect.stringMatching(/^sck_live_[A-Za-z0-9_-]+$/),
        start: expect.stringMatching(/^sck_live_/),
        enabled: true,
      }),
    );

    const tokenId = created.token.id;
    const plaintextToken = created.token.key;
    cleanup.add(`CLI token ${tokenId}`, async () => {
      const response = await request.delete(`/api/cli-tokens/${tokenId}`);
      expect([200, 404]).toContain(response.status());
    });

    const listResponse = await request.get('/api/cli-tokens');
    expect(listResponse.status()).toBe(200);
    const list = (await listResponse.json()) as {
      success: boolean;
      tokens: Array<Record<string, unknown>>;
    };
    const listed = list.tokens.find((token) => token.id === tokenId);
    expect(listed).toEqual(
      expect.objectContaining({ name: originalName, enabled: true, start: created.token.start }),
    );
    expect(listed).not.toHaveProperty('key');
    expect(JSON.stringify(listed)).not.toContain(plaintextToken);

    const bearer = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${plaintextToken}` },
    });
    try {
      const configResponse = await bearer.get('/api/cli/project-config');
      expect(configResponse.status()).toBe(200);
      expect(configResponse.headers()['cache-control']).toContain('no-store');
      expect(await configResponse.json()).toEqual(
        expect.objectContaining({
          organization: expect.objectContaining({ id: expect.any(String) }),
          project: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        }),
      );

      const disableResponse = await request.patch(`/api/cli-tokens/${tokenId}`, {
        data: { enabled: false, name: renamedName },
      });
      expect(disableResponse.status()).toBe(200);
      expect(await disableResponse.json()).toMatchObject({
        success: true,
        token: { id: tokenId, name: renamedName, enabled: false },
      });

      const disabledResponse = await bearer.get('/api/cli/project-config');
      expect(disabledResponse.status()).toBe(401);
      expect(await disabledResponse.json()).toMatchObject({ error: expect.any(String) });
    } finally {
      await bearer.dispose();
    }

    const deleteResponse = await request.delete(`/api/cli-tokens/${tokenId}`);
    expect(deleteResponse.status()).toBe(200);
    expect(await deleteResponse.json()).toMatchObject({ success: true });

    const afterDelete = await request.get('/api/cli-tokens');
    expect(afterDelete.status()).toBe(200);
    const remaining = (await afterDelete.json()) as { tokens: Array<{ id: string }> };
    expect(remaining.tokens).not.toContainEqual(expect.objectContaining({ id: tokenId }));
  });

  test('variable and secret lifecycle preserves plaintext, redacts secrets, and authorizes explicit decrypt @high @security', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const page = projectAdminPage;
    const suffix = uniqueSuffix().toUpperCase().slice(-10);
    const variableKey = `E2E_VAR_${suffix}`;
    const secretKey = `E2E_SEC_${suffix}`;
    const variableValue = `visible-${suffix}`;
    const secretValue = `secret-${suffix}`;

    const projectsResponse = await request.get('/api/projects');
    expect(projectsResponse.status()).toBe(200);
    const projects = (await projectsResponse.json()) as {
      currentProject?: { id?: string } | null;
      data?: Array<{ id: string }>;
    };
    const projectId = projects.currentProject?.id ?? projects.data?.[0]?.id;
    expect(projectId).toEqual(expect.any(String));

    const createVariable = await request.post('/api/variables', {
      data: {
        key: variableKey,
        value: variableValue,
        isSecret: false,
        description: 'E2E plaintext contract',
      },
    });
    expect(createVariable.status()).toBe(201);
    const variable = (await createVariable.json()) as ProjectVariable;
    expect(variable).toMatchObject({
      id: expect.any(String),
      key: variableKey,
      value: variableValue,
      isSecret: false,
      type: 'variable',
    });
    expect(variable).not.toHaveProperty('encryptedValue');
    cleanup.add(`variable ${variable.id}`, async () => {
      const response = await request.delete(`/api/variables/${variable.id}`);
      expect([200, 404]).toContain(response.status());
    });

    const createSecret = await request.post('/api/variables', {
      data: {
        key: secretKey,
        value: secretValue,
        isSecret: true,
        description: 'E2E secret contract',
      },
    });
    expect(createSecret.status()).toBe(201);
    const secret = (await createSecret.json()) as ProjectVariable;
    expect(secret).toMatchObject({
      id: expect.any(String),
      key: secretKey,
      value: '[ENCRYPTED]',
      isSecret: true,
      type: 'secret',
    });
    expect(secret).not.toHaveProperty('encryptedValue');
    expect(JSON.stringify(secret)).not.toContain(secretValue);
    cleanup.add(`secret ${secret.id}`, async () => {
      const response = await request.delete(`/api/variables/${secret.id}`);
      expect([200, 404]).toContain(response.status());
    });

    const listResponse = await request.get('/api/variables');
    expect(listResponse.status()).toBe(200);
    const variables = (await listResponse.json()) as ProjectVariable[];
    expect(variables.find((item) => item.id === variable.id)).toMatchObject({
      key: variableKey,
      value: variableValue,
      isSecret: false,
    });
    const listedSecret = variables.find((item) => item.id === secret.id);
    expect(listedSecret).toEqual(expect.objectContaining({ key: secretKey, isSecret: true }));
    expect(listedSecret).not.toHaveProperty('value');
    expect(listedSecret).not.toHaveProperty('encryptedValue');
    expect(JSON.stringify(listedSecret)).not.toContain(secretValue);

    await page.goto('/variables');
    await expect(page).toHaveURL(/\/variables$/);
    await expect(page.getByRole('heading', { name: 'Variables', exact: true })).toBeVisible();
    const filter = page.getByPlaceholder('Filter by all available fields...');
    await filter.fill(variableKey);
    await expect(page.getByText(variableKey, { exact: true })).toBeVisible();
    await expect(page.getByText(variableValue, { exact: true })).toBeVisible();

    await filter.fill(secretKey);
    const secretRow = page.locator('tr').filter({ hasText: secretKey });
    await expect(secretRow).toBeVisible();
    await expect(secretRow).not.toContainText(secretValue);

    const nonSecretDecrypt = await request.post(
      `/api/projects/${projectId}/variables/${variable.id}/decrypt`,
    );
    expect(nonSecretDecrypt.status()).toBe(400);
    expect(await nonSecretDecrypt.json()).toEqual({ error: 'Variable is not a secret' });

    const decryptResponse = await request.post(
      `/api/projects/${projectId}/variables/${secret.id}/decrypt`,
    );
    expect(decryptResponse.status()).toBe(200);
    expect(await decryptResponse.json()).toMatchObject({
      success: true,
      data: { id: secret.id, key: secretKey, value: secretValue },
    });

    for (const id of [secret.id, variable.id]) {
      const deleteResponse = await request.delete(`/api/variables/${id}`);
      expect(deleteResponse.status()).toBe(200);
      expect(await deleteResponse.json()).toMatchObject({ success: true });

      const readAfterDelete = await request.get(`/api/variables/${id}`);
      expect(readAfterDelete.status()).toBe(404);
      expect(await readAfterDelete.json()).toEqual({ error: 'Variable not found' });
    }
  });

  test('CLI token and variable APIs reject unauthenticated access @high @security', async ({ playwright }) => {
    const unauthenticated = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      for (const endpoint of ['/api/cli-tokens', '/api/variables']) {
        const getResponse = await unauthenticated.get(endpoint);
        expect(getResponse.status()).toBe(401);
        expect(await getResponse.json()).toMatchObject({ error: expect.any(String) });

        const postResponse = await unauthenticated.post(endpoint, { data: {} });
        expect(postResponse.status()).toBe(401);
        expect(await postResponse.json()).toMatchObject({ error: expect.any(String) });
      }
    } finally {
      await unauthenticated.dispose();
    }
  });
});
