import { expect, test } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';

// Spending caps are owner-only (admins keep usage alerts). Nothing here writes a cap: the denied calls never reach the
// service, and the one allowed write flips a usage alert and restores it.
test.describe('Spending caps are owner-only @admin @billing @security', () => {
  test.beforeAll(() => {
    requireRbacUser('orgOwner');
    requireRbacUser('orgAdmin');
  });

  const headers = (baseURL: string | undefined) => {
    const origin = new URL(baseURL as string).origin;
    return { Origin: origin, Referer: `${origin}/org-admin` };
  };

  test('an org admin gets 403 for every cap field but can still save usage alerts @high @security', async ({ orgAdminPage: page }, testInfo) => {
    const request = page.request;
    const h = headers(testInfo.project.use.baseURL);

    const before = await request.get('/api/billing/settings');
    expect(before.status()).toBe(200);
    const settings = (await before.json()) as { notifyAt50Percent: boolean };

    for (const data of [
      { enableSpendingLimit: true },
      { hardStopOnLimit: true },
      { monthlySpendingLimitDollars: 1234.56 },
      { resetSpendingLimitToPlanDefault: true },
    ]) {
      const denied = await request.patch('/api/billing/settings', { headers: h, data });
      expect(denied.status(), JSON.stringify(data)).toBe(403);
      expect(await denied.json()).toEqual({ error: 'Only the organization owner can change spending limits' });
    }

    // Alerts are still an admin setting: flip one and put it back.
    const flipped = await request.patch('/api/billing/settings', { headers: h, data: { notifyAt50Percent: !settings.notifyAt50Percent } });
    try {
      expect(flipped.status(), await flipped.text()).toBe(200);
      expect(((await flipped.json()) as { notifyAt50Percent: boolean }).notifyAt50Percent).toBe(!settings.notifyAt50Percent);
    } finally {
      const restored = await request.patch('/api/billing/settings', { headers: h, data: { notifyAt50Percent: settings.notifyAt50Percent } });
      expect(restored.status(), await restored.text()).toBe(200);
    }

    // The denied cap calls changed nothing.
    const after = (await (await request.get('/api/billing/settings')).json()) as Record<string, unknown>;
    expect(after).toMatchObject({ notifyAt50Percent: settings.notifyAt50Percent });
  });

  test('the cap controls are disabled for an org admin and editable for the owner @high @positive', async ({ orgAdminPage, orgOwnerPage }) => {
    const current = (await (await orgOwnerPage.request.get('/api/billing/current')).json()) as { subscription: { plan: string } };

    for (const page of [orgAdminPage, orgOwnerPage]) {
      await page.goto('/org-admin?tab=subscription', { waitUntil: 'load' });
    }
    // Unlimited (self-hosted) plans have no billing controls at all, so there is no cap to disable.
    if (current.subscription.plan === 'unlimited') {
      await expect(orgAdminPage.getByLabel('Enable overage spending limit')).toHaveCount(0);
      await expect(orgOwnerPage.getByLabel('Enable overage spending limit')).toHaveCount(0);
      return;
    }
    await expect(orgOwnerPage.getByLabel('Enable overage spending limit')).toBeEnabled({ timeout: 30_000 });
    await expect(orgAdminPage.getByLabel('Enable overage spending limit')).toBeDisabled({ timeout: 30_000 });
  });
});
