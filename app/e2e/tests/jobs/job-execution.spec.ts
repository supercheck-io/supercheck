import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { JobCreatePage, JobsPage } from '../../pages/jobs.page';
import { createJob, deleteJob, deleteTest } from '../../utils/test-data';

type JobRun = {
  id: string;
  jobId: string;
  status: string;
  trigger: string;
};

test.describe('Job execution @jobs @execution', () => {
  test('job creation UI exposes the supported execution types @high @positive', async ({ projectAdminPage: page }) => {
    const jobsPage = new JobsPage(page);
    await jobsPage.navigate();
    await jobsPage.clickCreate();

    const createPage = new JobCreatePage(page);
    await createPage.expectLoaded();
    await expect(createPage.playwrightCard).toBeVisible({ timeout: 30_000 });
    await expect(createPage.k6Card).toBeVisible({ timeout: 30_000 });
  });

  test('triggers the selected job from the UI and persists a run @critical @positive', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const created = await createJob(request);
    if (created.createdTestId) {
      cleanup.add(`test ${created.createdTestId}`, () =>
        deleteTest(request, created.createdTestId!),
      );
    }
    cleanup.add(`job ${created.id}`, () => deleteJob(request, created.id));

    await page.goto('/jobs', { waitUntil: 'load' });
    const search = page.getByPlaceholder('Filter by all available fields...');
    await search.fill(created.name);
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toBeVisible();

    const runButton = row.getByRole('button', { name: 'Run', exact: true });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    await expect.poll(async () => latestRun(request, created.id), { timeout: 30_000 }).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        jobId: created.id,
        trigger: 'manual',
        status: expect.stringMatching(/^(queued|running|passed|failed|error|blocked)$/),
      }),
    );
  });
});

async function latestRun(
  request: import('@playwright/test').APIRequestContext,
  jobId: string,
): Promise<JobRun | undefined> {
  const response = await request.get('/api/runs', {
    params: { jobId, page: '1', limit: '10' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: JobRun[] };
  return body.data[0];
}
