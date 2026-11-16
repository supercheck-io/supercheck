import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { test } from '../../fixtures';
import { hasRbacUser } from '../../utils/env';
import { waitForHydration } from '../../utils/hydration';

/**
 * Opens /setup as an invited member. A member who has not answered the persona question yet is
 * sent to /setup/welcome, which offers the persona only (never the wizard); answering (Skip)
 * marks it seen, so later runs go straight to the checklist.
 */
async function openSetup(page: Page): Promise<void> {
  await page.goto('/setup');
  await waitForHydration(page);
  const welcome = page.getByTestId('setup-welcome');
  const checklist = page.getByTestId('setup-checklist-view');
  await expect(welcome.or(checklist)).toBeVisible({ timeout: 30_000 });
  if (await welcome.isVisible()) {
    await expect(page).toHaveURL(/\/setup\/welcome/);
    await expect(welcome.getByRole('radio')).toHaveCount(4);
    await expect(welcome.getByRole('button', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.getByTestId('setup-wizard')).toHaveCount(0);
    await welcome.getByRole('button', { name: 'Skip' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/setup');
    await waitForHydration(page);
  }
  await expect(checklist).toBeVisible({ timeout: 30_000 });
}

test.describe('Project setup invited members @setup', () => {
  test('a viewer gets a read-only checklist and never the wizard @critical', async ({ viewerPage: page }) => {
    test.skip(!hasRbacUser('viewer'), 'E2E viewer credentials are not configured');
    await openSetup(page);

    await expect(page.getByText('You have view access. A project admin can finish setup.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Start setup|Continue|Dismiss|Run setup again)$/ })).toHaveCount(0);
    await expect(page.getByTestId('setup-wizard')).toHaveCount(0);
    await expect(page.getByTestId('setup-checklist')).toBeVisible();
    await expect(page.getByTestId('checklist-item-monitors')).toBeVisible();
    // The shared project already has data, so the dashboard card only appears once setup is in progress.
  });

  test('an editor sees the repeat-until-ack card disabled with "Ask a project admin" @critical', async ({ editorPage: page }) => {
    test.skip(!hasRbacUser('editor'), 'E2E editor credentials are not configured');
    await openSetup(page);

    await page.getByRole('button', { name: /^(Start setup|Continue)$/ }).click();
    const wizard = page.getByTestId('setup-wizard');
    await expect(wizard).toBeVisible();
    await wizard.getByTestId('setup-step-alerts').click();
    await expect(wizard.getByTestId('setup-step-alerts')).toHaveAttribute('aria-current', 'step');

    const card = wizard.getByTestId('setup-card-repeat');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Ask a project admin');
    await expect(card.getByRole('switch')).toBeDisabled();
  });
});
