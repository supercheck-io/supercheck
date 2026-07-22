import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';

test.describe('Status page lifecycle @status-pages @critical', () => {
  test('creates a draft status page through the UI and persists it', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);

    const response = await request.get('/api/status-pages', {
      params: { page: '1', limit: '100' },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; name: string; headline: string | null; status: string }>;
    };
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: created.id,
        name: created.name,
        headline: created.headline,
        status: 'draft',
      }),
    );
  });
});
