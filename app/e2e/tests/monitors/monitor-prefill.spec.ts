import { expect } from '@playwright/test';

import { test } from '../../fixtures';

// "Monitor this" from the free tools on supercheck.io lands here after sign-in.
test.describe('Monitor create pre-fill from the free tools @monitors', () => {
  test('pre-fills target, title and method without creating anything @high @positive', async ({ projectAdminPage: page }) => {
    const url = 'https://example.com/health?probe=1';
    await page.goto(
      `/monitors/create?type=http_request&url=${encodeURIComponent(url)}&name=example.com&method=HEAD`,
    );
    const form = page.locator('form');
    await expect(form.getByLabel('Target')).toHaveValue(url);
    await expect(form.getByLabel('Title')).toHaveValue('example.com');
    await expect(form.getByText('HEAD', { exact: true }).first()).toBeVisible();
  });

  test('ignores a non-http URL and leaves the field empty @medium @negative', async ({ projectAdminPage: page }) => {
    await page.goto(`/monitors/create?type=website&url=${encodeURIComponent('javascript:alert(1)')}&name=x`);
    await expect(page.locator('form').getByLabel('Target')).toHaveValue('');
  });
});
