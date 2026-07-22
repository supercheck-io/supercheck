import { test as setup } from '@playwright/test';
import { SignInPage } from '../pages/auth';
import { env } from '../utils/env';

const authFile = 'user-auth-state.json';

setup('authenticate as regular test user', async ({ page }) => {
  if (!env.testUser.email || !env.testUser.password) {
    throw new Error('E2E_TEST_USER credentials required for setup');
  }

  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  await signInPage.signIn(env.testUser.email, env.testUser.password);

  try {
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15000 });
  } catch (error) {
    const message = (await signInPage.getErrorMessage())?.trim();
    if (!message) {
      throw error;
    }

    throw new Error(
      `E2E authentication failed for ${env.testUser.email}: ${message}. ` +
        'Verify that the GitHub E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD secrets match an existing invited user.',
    );
  }

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Save storage state
  await page.context().storageState({ path: authFile });
});
