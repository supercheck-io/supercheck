import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';

test.describe('Status-page incident lifecycle @status-pages @incidents', () => {
  test('creates a component and incident, publishes them, and exposes public RSS/iCal evidence @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const statusPage = await createStatusPageThroughUi(page, request, cleanup);
    const componentName = `E2E component ${Date.now()}`;
    const incidentName = `E2E incident ${Date.now()}`;
    const incidentMessage = 'The regression suite is investigating a bounded test disruption.';

    await page.goto(`/status-pages/${statusPage.id}`);
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await page.getByRole('button', { name: 'Add Component', exact: true }).click();
    const componentDialog = page.getByRole('dialog', { name: 'Add Component' });
    await componentDialog.getByLabel('Name *').fill(componentName);
    await componentDialog.getByLabel('Description').fill('Isolated E2E status-page component');
    await componentDialog.getByRole('button', { name: 'Add Component', exact: true }).click();
    await expect(componentDialog).toBeHidden();
    await expect(page.getByText(componentName, { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Incidents', exact: true }).click();
    await page.getByRole('button', { name: 'Create Incident', exact: true }).click();
    const incidentDialog = page.getByRole('dialog', { name: 'Create Incident' });
    await incidentDialog.getByLabel('Title *').fill(incidentName);
    await incidentDialog.getByLabel('Initial Message *').fill(incidentMessage);
    await incidentDialog.getByLabel(componentName, { exact: true }).click();
    await incidentDialog.getByRole('button', { name: 'Create Incident', exact: true }).click();
    await expect(incidentDialog).toBeHidden();
    await expect(page.getByText(incidentName, { exact: true })).toBeVisible();

    const detail = await request.get(`/api/status-pages/${statusPage.id}`);
    expect(detail.status(), await detail.text()).toBe(200);
    expect(await detail.json()).toMatchObject({
      statusPage: { id: statusPage.id },
      stats: { activeIncidents: 1 },
    });

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect.poll(async () => {
      const response = await request.get(`/api/status-pages/${statusPage.id}`);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { statusPage: { status: string } };
      return body.statusPage.status;
    }).toBe('published');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();

    const rss = await request.get(`/api/status-pages/${statusPage.id}/rss`);
    expect(rss.status(), await rss.text()).toBe(200);
    expect(rss.headers()['content-type']).toContain('application/rss+xml');
    const rssBody = await rss.text();
    expect(rssBody).toContain(incidentName);
    expect(rssBody).toContain(incidentMessage);

    const calendar = await request.get(`/api/status-pages/${statusPage.id}/ical`);
    expect(calendar.status(), await calendar.text()).toBe(200);
    expect(calendar.headers()['content-type']).toContain('text/calendar');
    const calendarBody = await calendar.text();
    expect(calendarBody).toContain('BEGIN:VCALENDAR');
    expect(calendarBody).toContain(incidentName);
  });
});
