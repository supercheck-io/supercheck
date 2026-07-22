import { test as setup } from '@playwright/test';
import { SignInPage } from '../pages/auth';
import { env } from '../utils/env';

const authFile = 'user-auth-state.json';

setup('authenticate as regular test user', async ({ page, request }) => {
  if (!env.testUser.email || !env.testUser.password) {
    throw new Error('E2E_TEST_USER credentials required for setup');
  }

  // First try sign-up via API to ensure user exists
  await request.post('/api/auth/sign-up/email', {
    data: {
      email: env.testUser.email,
      password: env.testUser.password,
      name: 'E2E Test User',
    },
  }).catch(() => { /* user already exists */ });

  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  await signInPage.signIn(env.testUser.email, env.testUser.password);

  // Wait for redirect away from sign-in
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15000 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Save storage state
  await page.context().storageState({ path: authFile });
});
