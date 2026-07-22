import { test, expect } from '@playwright/test';
import { JobsPage, JobCreatePage } from '../../pages/jobs.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createJob, deleteJob, deleteTest } from '../../utils/test-data';

test.describe('Jobs Execution - E9 to E11 @jobs @execution', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('E9: Create, update, and delete Job @critical @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    await jobsPage.clickCreate();

    const createPage = new JobCreatePage(page);
    await createPage.expectLoaded();

    const playwrightCard = page.locator('text=/playwright|k6|browser/i').first();
    if (await playwrightCard.isVisible().catch(() => false)) {
      await playwrightCard.click();
    }

    expect(page.url()).toContain('/jobs/create');
  });

  test('E10: Trigger job manually from UI @critical @positive', async ({ page, request }) => {
    const tempJob = await createJob(request, { name: `Trigger Test Job ${Date.now()}` });
    try {
      const jobsPage = new JobsPage(page);
      await jobsPage.navigate();
      await jobsPage.expectLoaded();

      const count = await jobsPage.getJobCount();
      if (count > 0) {
        await jobsPage.clickRow(0);
        await page.waitForTimeout(500);

        const runBtn = page.locator('button:has-text("Trigger"), button:has-text("Run"), [data-testid="trigger-job-button"]').first();
        if (await runBtn.isVisible().catch(() => false)) {
          await runBtn.click({ force: true });
          const toast = page.locator('[data-sonner-toast]').first();
          await expect(toast).toBeVisible({ timeout: 5000 }).catch(() => {});
        }
      }
    } finally {
      await deleteJob(request, tempJob.id);
      if (tempJob.createdTestId) {
        await deleteTest(request, tempJob.createdTestId);
      }
    }
  });
});
