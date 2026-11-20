import { test as setup } from '@playwright/test';
import { env } from '../utils/env';
import { CAPTCHA_TEST_HEADERS, preferredProjectId } from '../utils/api-auth';

const authFile = 'user-auth-state.json';

setup('authenticate as regular test user', async ({ request, baseURL }) => {
  if (!env.testUser.email || !env.testUser.password) {
    throw new Error('E2E_TEST_USER credentials required for setup');
  }

  const signInResponse = await request.post('/api/auth/sign-in/email', {
    headers: CAPTCHA_TEST_HEADERS,
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

  // Keep E2E records in the dedicated test project when one is configured.
  const projects = await request.get('/api/projects');
  const current = projects.ok() ? ((await projects.json()) as { currentProject?: { id?: string } }).currentProject?.id : undefined;
  if (current) {
    const target = await preferredProjectId(request, current);
    if (target !== current) {
      // Project switching is same-origin guarded; an API request context sends no Origin by itself.
      const origin = new URL(baseURL as string).origin;
      const switched = await request.post('/api/projects/switch', { headers: { origin, referer: `${origin}/` }, data: { projectId: target } });
      if (!switched.ok()) throw new Error(`Switching to E2E_TEST_PROJECT_ID failed (${switched.status()})`);
    }
  }

  await request.storageState({ path: authFile });
});
