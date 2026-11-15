import { expect, type Page } from '@playwright/test';
import { test } from '../../fixtures';
import { createProjectSecret, deleteMonitor, deleteProjectSecret } from '../../utils/test-data';
import { waitForHydration } from '../../utils/hydration';
import { startMcpStub, STUB_TOOLS } from '../../utils/mcp-stub-server';

// The worker, not the browser, calls the server, so the stub must be reachable from the worker.
// Set E2E_MCP_STUB_HOST to the stub's address as the worker sees it (for example host.docker.internal), and run the app
// and worker with ALLOW_INTERNAL_TARGETS=true because the stub speaks plain http on a private address.
const stubHost = process.env.E2E_MCP_STUB_HOST;
const SKIP_REASON = 'Set E2E_MCP_STUB_HOST (and ALLOW_INTERNAL_TARGETS=true on the app and worker) to reach the stub MCP server';

test.describe('MCP monitor @monitors', () => {
  test.skip(!stubHost, SKIP_REASON);

  async function fillAndSave(page: Page, opts: { name: string; url: string; secretKey: string }) {
    await page.getByRole('textbox', { name: 'Title' }).fill(opts.name);
    await page.getByRole('textbox', { name: 'Server URL' }).fill(opts.url);
    await page.getByTestId('mcp-auth-type').click();
    await page.getByRole('option', { name: 'Bearer token' }).click();
    await page.getByTestId('mcp-secret').click();
    await page.getByRole('option', { name: opts.secretKey }).click();
    await page.getByTestId('mcp-required-tools-input').fill('echo');
    await page.getByTestId('mcp-required-tools-input').press('Enter');
    await expect(page.getByTestId('mcp-required-tools')).toContainText('echo');
    await page.locator('form button[type="submit"]').click();
    // The create wizard continues to the alert settings step before saving.
    await expect(page).toHaveURL(/wizardStep=alerts/);
    await page.getByRole('button', { name: 'Save and test', exact: true }).click();
    await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}$/);
    return new URL(page.url()).pathname.split('/').pop() as string;
  }

  test('creates from Quick Create with Save and test and lists the tools @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const token = `e2e-token-${Date.now()}`;
    const stub = await startMcpStub(token);
    cleanup.add('mcp stub', () => stub.close());
    const secretKey = `E2E_MCP_${String(Date.now()).slice(-6)}`;
    const secret = await createProjectSecret(request, secretKey, token);
    cleanup.add(`secret ${secretKey}`, () => deleteProjectSecret(request, secret.projectId, secret.id));

    await page.goto('/create');
    await waitForHydration(page);
    await page.getByRole('button', { name: /MCP Monitor/ }).click();
    await expect(page).toHaveURL(/\/monitors\/create\?type=mcp_server/);
    await waitForHydration(page);
    await expect(page.getByTestId('mcp-server-fields')).toBeVisible();

    const monitorId = await fillAndSave(page, { name: `E2E MCP ${Date.now()}`, url: `http://${stubHost}:${stub.port}/mcp`, secretKey });
    cleanup.add(`monitor ${monitorId}`, () => deleteMonitor(request, monitorId));

    // The first check fires on create; reload until the worker has stored the tool list.
    await expect(async () => {
      await page.reload();
      await waitForHydration(page);
      await expect(page.getByTestId('mcp-tool-list')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    for (const tool of STUB_TOOLS) await expect(page.getByTestId('mcp-tool-list')).toContainText(tool.name);
    await expect(page.getByTestId('mcp-tool-count')).toHaveText(String(STUB_TOOLS.length));
    await expect(page.getByTestId('mcp-stat-server')).toContainText('e2e-stub');
    expect(stub.requests()).toBeGreaterThan(0);
  });

  test('opens the form from Cmd+K @medium @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/');
    await waitForHydration(page);
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByPlaceholder('Type a command or search...').fill('MCP Monitor');
    await page.getByRole('option', { name: /MCP Monitor/ }).first().click();
    await expect(page).toHaveURL(/\/monitors\/create\?type=mcp_server/);
    await waitForHydration(page);
    await expect(page.getByTestId('mcp-server-fields')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Server URL' })).toBeVisible();
  });

  test('a wrong token shows Login failed @high @negative', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const stub = await startMcpStub(`e2e-right-${Date.now()}`);
    cleanup.add('mcp stub', () => stub.close());
    const secretKey = `E2E_MCP_BAD_${String(Date.now()).slice(-6)}`;
    const secret = await createProjectSecret(request, secretKey, 'e2e-wrong-token');
    cleanup.add(`secret ${secretKey}`, () => deleteProjectSecret(request, secret.projectId, secret.id));

    await page.goto('/monitors/create?type=mcp_server');
    await waitForHydration(page);
    const monitorId = await fillAndSave(page, { name: `E2E MCP bad token ${Date.now()}`, url: `http://${stubHost}:${stub.port}/mcp`, secretKey });
    cleanup.add(`monitor ${monitorId}`, () => deleteMonitor(request, monitorId));

    await expect(async () => {
      await page.reload();
      await waitForHydration(page);
      await expect(page.getByTestId('mcp-failure')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    await expect(page.getByTestId('mcp-failure')).toContainText('Login failed');
  });
});
