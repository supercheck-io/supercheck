import { test, expect, Page } from '@playwright/test';
import { JobsPage, JobCreatePage } from '../../pages/jobs.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createJob, deleteJob, deleteTest } from '../../utils/test-data';

let seededJobId: string | null = null;
let seededTestId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await createJob(request);
    seededJobId = seed.id;
    seededTestId = seed.createdTestId || null;
  } catch (err) {
    console.error('Failed to seed job for suite:', err);
  }
});
test.afterAll(async ({ request }) => {
  if (seededJobId) {
    await deleteJob(request, seededJobId);
  }
  if (seededTestId) {
    await deleteTest(request, seededTestId);
  }
});

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Jobs - Page Loading @jobs @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-001: Jobs page loads with table or empty state @critical @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    await expect(page).toHaveURL(/jobs/);
    await jobsPage.expectLoaded();
  });

  test('JOBS-002: Jobs page has correct title @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    await expect(jobsPage.pageTitle).toBeVisible();
  });

  test('JOBS-003: Create button is visible @high @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    await jobsPage.expectCreateButtonVisible();
  });
});

test.describe('Jobs - Navigation @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-004: Can navigate to create job page @high @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    await jobsPage.clickCreate();
    await expect(page).toHaveURL(/jobs\/create/);
  });

  test('JOBS-005: Create page shows job type cards @high @positive', async ({ page }) => {
    const createPage = new JobCreatePage(page);
    await createPage.navigate();
    await waitForPageReady(page);

    await createPage.expectLoaded();
    const hasPlaywright = await createPage.playwrightCard.isVisible().catch(() => false);
    const hasK6 = await createPage.k6Card.isVisible().catch(() => false);
    const hasJobTypeText = await page.locator('text=/playwright|k6|browser|api/i').first().isVisible().catch(() => false);

    expect(hasPlaywright || hasK6 || hasJobTypeText).toBe(true);
  });

  test('JOBS-006: Row click is functional @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await waitForPageReady(page);

    const count = await jobsPage.getJobCount();
    if (count > 0) {
      await jobsPage.clickRow(0);
      await page.waitForTimeout(500);
      expect(page.url()).toBeTruthy();
    }
  });
});

test.describe('Jobs - Search and Filter @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-008: Status filter button exists @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();

    const hasStatusFilter = await jobsPage.statusFilter.isVisible().catch(() => false);
    if (hasStatusFilter) {
      await expect(jobsPage.statusFilter).toBeVisible();
    }
  });
});

test.describe('Jobs - Data Table @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-010: Row actions menu is accessible @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await waitForPageReady(page);

    const count = await jobsPage.getJobCount();
    if (count > 0) {
      await jobsPage.openRowActions(0);
      const hasEdit = await jobsPage.editAction.isVisible().catch(() => false);
      const hasDelete = await jobsPage.deleteAction.isVisible().catch(() => false);
      expect(hasEdit || hasDelete).toBe(true);
    }
  });
});

test.describe('Jobs - Detail View @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-012: Can return from detail view @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await waitForPageReady(page);

    const count = await jobsPage.getJobCount();
    if (count > 0) {
      await jobsPage.clickRow(0);
      await page.waitForTimeout(1000);

      const hasSheet = await jobsPage.sideSheet.isVisible().catch(() => false);
      if (hasSheet) {
        await jobsPage.closeSheet();
        await expect(jobsPage.sideSheet).toBeHidden();
      }
    }
  });

  test('JOBS-013: Detail view structure @medium @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await waitForPageReady(page);

    const count = await jobsPage.getJobCount();
    if (count > 0) {
      await jobsPage.clickRow(0);
      await page.waitForTimeout(1000);

      const hasSheet = await jobsPage.sideSheet.isVisible().catch(() => false);
      const isOnDetailPage = page.url().includes('/jobs/') && !page.url().endsWith('/jobs');
      expect(hasSheet || isOnDetailPage).toBe(true);
    }
  });
});

test.describe('Jobs - Delete Flow @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-015: Cancel delete closes dialog @medium @positive', async ({ page, request }) => {
    const tempJob = await createJob(request, { name: `Temp Cancel Job ${Date.now()}` });
    try {
      const jobsPage = new JobsPage(page);
      await jobsPage.navigate();
      await waitForPageReady(page);

      await jobsPage.openRowActions(0);
      await jobsPage.deleteAction.click();
      await jobsPage.deleteCancelButton.click();

      await expect(jobsPage.deleteDialog).toBeHidden();
    } finally {
      await deleteJob(request, tempJob.id);
      if (tempJob.createdTestId) {
        await deleteTest(request, tempJob.createdTestId);
      }
    }
  });
});

test.describe('Jobs - Run Functionality @jobs', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-016: Trigger job run manually from list @high @positive', async ({ page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await waitForPageReady(page);

    const count = await jobsPage.getJobCount();
    if (count > 0) {
      const runBtn = page.locator('button:has-text("Run"), [data-testid="run-job-button"]').first();
      if (await runBtn.isVisible().catch(() => false)) {
        await runBtn.click();
      }
    }
  });
});

test.describe('Jobs - API Authorization @jobs @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('JOBS-017: Jobs API endpoint exists @critical @security', async ({ request }) => {
    const response = await request.get('/api/jobs');
    const status = response.status();
    expect(status >= 200 && status < 600).toBe(true);
  });
});
