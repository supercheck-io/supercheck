import { expect, test } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';

test.describe('Billing and usage @admin @billing', () => {
  test.beforeAll(() => requireRbacUser('orgOwner'));

  test('org owner sees the persisted plan, usage, limits, and spending state in API and UI @high @positive', async ({
    orgOwnerPage: page,
  }) => {
    const currentResponse = await page.request.get('/api/billing/current');
    expect(currentResponse.status()).toBe(200);
    const current = (await currentResponse.json()) as {
      subscription: { plan: string; status: string; planName: string; basePriceCents: number };
      usage: Record<string, { used: number; included: number; overage: number; percentage: number }>;
      limits: Record<string, Record<string, number>>;
      planFeatures: { customDomains: boolean; ssoEnabled: boolean; dataRetentionDays: number };
    };
    expect(current.subscription).toEqual(
      expect.objectContaining({
        plan: expect.stringMatching(/^(plus|pro|unlimited)$/),
        status: expect.any(String),
        planName: expect.any(String),
        basePriceCents: expect.any(Number),
      }),
    );
    for (const metric of ['playwrightMinutes', 'k6VuMinutes', 'aiCredits', 'sreInvestigations']) {
      expect(current.usage[metric]).toEqual(
        expect.objectContaining({
          used: expect.any(Number),
          included: expect.any(Number),
          overage: expect.any(Number),
          percentage: expect.any(Number),
        }),
      );
    }
    for (const resource of ['monitors', 'statusPages', 'projects', 'teamMembers']) {
      expect(current.limits[resource]).toEqual(
        expect.objectContaining({
          current: expect.any(Number),
          limit: expect.any(Number),
          remaining: expect.any(Number),
          percentage: expect.any(Number),
        }),
      );
    }

    const usageResponse = await page.request.get('/api/billing/usage');
    expect(usageResponse.status()).toBe(200);
    expect(await usageResponse.json()).toMatchObject({
      usage: expect.any(Object),
      spending: {
        currentDollars: expect.any(Number),
        limitEnabled: expect.any(Boolean),
        hardStopEnabled: expect.any(Boolean),
        percentageUsed: expect.any(Number),
        isAtLimit: expect.any(Boolean),
      },
    });

    await page.goto('/billing');
    if (current.subscription.plan === 'unlimited') {
      await expect(page).toHaveURL(/\/org-admin\?tab=subscription$/);
      await expect(page.getByRole('tab', { name: 'Projects', exact: true })).toHaveAttribute('data-state', 'active');
      await expect(page.getByRole('tab', { name: 'Subscription', exact: true })).toHaveCount(0);
    } else {
      await expect(page).toHaveURL(/\/org-admin\?tab=subscription$/);
      await expect(page.getByRole('heading', { name: `${current.subscription.planName} Plan` })).toBeVisible();
      await expect(page.getByText('Usage This Period', { exact: true })).toBeVisible();
      await expect(page.getByText('Resource Limits', { exact: true })).toBeVisible();
    }
  });
});

test.describe('Organization audit log @admin @security', () => {
  test.beforeAll(() => {
    requireRbacUser('orgOwner');
    requireRbacUser('viewer');
  });

  test('org owner can query and render tenant-scoped audit records while viewer is forbidden @high @security', async ({
    orgOwnerPage,
    viewerPage,
  }) => {
    const response = await orgOwnerPage.request.get('/api/audit', {
      params: { page: '1', limit: '10', sortOrder: 'desc' },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        logs: Array<{ id: string; action: string; createdAt: string; user: unknown }>;
        pagination: { currentPage: number; totalCount: number; limit: number; hasNext: boolean; hasPrev: boolean };
        filters: { actions: string[] };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.pagination).toEqual(
      expect.objectContaining({
        currentPage: 1,
        totalCount: expect.any(Number),
        limit: 10,
        hasNext: expect.any(Boolean),
        hasPrev: false,
      }),
    );
    for (const log of body.data.logs) {
      expect(log).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          action: expect.any(String),
          createdAt: expect.any(String),
        }),
      );
    }

    await orgOwnerPage.goto('/org-admin?tab=audit', { waitUntil: 'load' });
    await expect(orgOwnerPage.getByRole('tab', { name: 'Audit' })).toHaveAttribute(
      'data-state',
      'active',
    );
    const auditPanel = orgOwnerPage.getByRole('tabpanel', { name: 'Audit' });
    await expect(auditPanel).toBeVisible();
    await expect(auditPanel.getByRole('table')).toBeVisible();

    const viewerResponse = await viewerPage.request.get('/api/audit');
    expect(viewerResponse.status()).toBe(403);
    expect(await viewerResponse.json()).toEqual({
      success: false,
      error: 'Insufficient permissions to view audit logs',
    });
  });
});

test.describe('Super admin console @admin @security', () => {
  test.beforeAll(() => requireRbacUser('superAdmin'));

  test('super admin dashboard exposes overview, users, organizations, locations, and queues @critical @security', async ({
    superAdminPage: page,
  }) => {
    await page.goto('/super-admin', { waitUntil: 'load' });
    await expect(page).toHaveURL(/\/super-admin(?:\?tab=overview)?$/);
    await expect(page.getByText('Total Users', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Organizations', { exact: true }).first()).toBeVisible();

    for (const tabName of ['Users', 'Organizations', 'Locations', 'Queues']) {
      const tab = page.getByRole('tab', { name: tabName, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('data-state', 'active');
      await expect(page).toHaveURL(new RegExp(`tab=${tabName.toLowerCase()}`));
      const panel = page.getByRole('tabpanel', { name: tabName });
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/^Loading /)).toHaveCount(0, { timeout: 30_000 });
      if (tabName === 'Queues') {
        const queueDashboard = panel.locator('iframe');
        await expect(queueDashboard).toBeVisible({ timeout: 30_000 });
        await expect(
          queueDashboard.contentFrame().getByRole('searchbox', { name: 'Filter queues' }),
        ).toBeVisible({ timeout: 30_000 });
      } else {
        await expect(panel.getByRole('table')).toBeVisible({ timeout: 30_000 });
      }
    }
  });
});

test.describe('Billing and audit authentication @admin @billing @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('billing and audit APIs reject unauthenticated callers @high @security', async ({ request }) => {
    for (const endpoint of ['/api/billing/current', '/api/billing/usage', '/api/audit']) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
    }
  });
});
