import { test as setup } from '@playwright/test';
import { env } from '../utils/env';

const authFile = 'user-auth-state.json';

setup('authenticate as regular test user', async ({ request }) => {
  if (!env.testUser.email || !env.testUser.password) {
    throw new Error('E2E_TEST_USER credentials required for setup');
  }

  const signInResponse = await request.post('/api/auth/sign-in/email', {
    data: {
      email: env.testUser.email.trim(),
      password: env.testUser.password,
      rememberMe: true,
    },
  });

  if (!signInResponse.ok()) {
    const responseBody = await signInResponse.text();
    throw new Error(
      `E2E authentication API failed for ${env.testUser.email} ` +
        `(${signInResponse.status()}): ${responseBody}. ` +
        'Verify that the GitHub E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD secrets match an existing invited user.',
    );
  }

  await request.storageState({ path: authFile });
});
