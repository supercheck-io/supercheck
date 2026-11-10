/**
 * Setup for the PR screenshot tour: signs up a fresh user on the throwaway app,
 * seeds fake data, and saves the session plus seeded IDs for app-tour.spec.ts.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test as setup } from '@playwright/test';
import { SignUpPage } from '../../pages/auth';
import { createJob, createMonitor, createTest } from '../../utils/test-data';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';
import { SCREENSHOT_AUTH_STATE, SCREENSHOT_SEED, SCREENSHOT_USER } from '../../utils/screenshot';

setup('sign up and seed screenshot data', async ({ page, baseURL }) => {
  // The tour signs up a fixed account and never cleans up, so it only targets a throwaway local app.
  const host = new URL(baseURL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`Screenshot tour only runs against a disposable local app, not ${host}`);
  }
  const signUp = new SignUpPage(page);
  await signUp.navigate();
  await signUp.signUpWithEmail(SCREENSHOT_USER.name, SCREENSHOT_USER.email, SCREENSHOT_USER.password);
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-up'), { timeout: 60_000 });

  // Sign-up provisions the default organization and project asynchronously.
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/projects');
      if (!res.ok()) return undefined;
      return ((await res.json()) as { currentProject?: { id?: string } }).currentProject?.id;
    }, { timeout: 60_000 })
    .toBeTruthy();

  const testId = (await createTest(page.request, { title: 'Checkout flow' })).id;
  const seed = {
    test: testId,
    // No cron schedule: the throwaway app has no worker, so the job never runs.
    job: (await createJob(page.request, { name: 'Nightly regression', testId })).id,
    monitor: (await createMonitor(page.request, { name: 'Marketing site' })).id,
    // The tour keeps its data; the database is discarded with the CI job.
    statusPage: (await createStatusPageThroughUi(page, page.request, { add() {} }, 'Demo')).id,
  };

  await writeFile(SCREENSHOT_SEED, JSON.stringify(seed));
  await page.context().storageState({ path: SCREENSHOT_AUTH_STATE });
});
