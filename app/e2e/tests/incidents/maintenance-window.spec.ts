import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { NO_WORKER, NO_WORKER_REASON } from '../../fixtures/checkpoint.fixture';
import { waitForHydration } from '../../utils/hydration';
import { createMonitor, deleteMonitor } from '../../utils/test-data';

test.describe('Maintenance windows @incidents', () => {
  test('a monitor-scoped window shows a Maintenance badge and banner until it ends @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    // Disabled: nothing is checked or alerted outside the test; the badge follows the window, not the status.
    const monitor = await createMonitor(request, { name: `E2E maintenance ${Date.now()}`, enabled: false });
    cleanup.add(`monitor ${monitor.id}`, () => deleteMonitor(request, monitor.id));

    const now = new Date(Date.now() - 60_000);
    const created = await request.post('/api/maintenance-windows', {
      data: {
        title: `E2E window ${Date.now()}`,
        scope: 'monitors',
        targets: { monitorIds: [monitor.id] },
        recurrence: 'once',
        timezone: 'UTC',
        localStartTime: now.toISOString().slice(11, 16),
        durationMinutes: 30,
        startsOn: now.toISOString().slice(0, 10),
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const windowId = ((await created.json()) as { window: { id: string } }).window.id;
    cleanup.add(`maintenance window ${windowId}`, async () => {
      await request.post(`/api/maintenance-windows/${windowId}/end`);
      const removed = await request.delete(`/api/maintenance-windows/${windowId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Window cleanup failed: ${await removed.text()}`);
    });

    const listed = (await (await request.get('/api/monitors')).json()) as { data: Array<{ id: string; inMaintenance?: boolean; status: string }> };
    expect(listed.data.find((m) => m.id === monitor.id)).toMatchObject({ inMaintenance: true, status: expect.not.stringMatching(/^maintenance$/) });

    await page.goto('/monitors');
    await waitForHydration(page);
    const row = page.getByRole('row').filter({ hasText: monitor.name });
    // An icon-only wrench chip beside the real status, so the cell never wraps.
    await expect(row.getByRole('img', { name: 'In maintenance: alerts muted' })).toBeVisible();

    await page.goto(`/monitors/${monitor.id}`);
    await waitForHydration(page);
    // Shown under the monitor name, so the header actions stay on one line.
    await expect(page.getByTestId('monitor-maintenance-status')).toContainText('In maintenance until');
    await expect(page.getByTestId('monitor-maintenance-status')).toContainText('UTC');

    expect((await request.post(`/api/maintenance-windows/${windowId}/end`)).status()).toBe(200);
    const after = (await (await request.get('/api/monitors')).json()) as { data: Array<{ id: string; inMaintenance?: boolean }> };
    expect(after.data.find((m) => m.id === monitor.id)?.inMaintenance).toBe(false);
    await page.goto('/monitors');
    await waitForHydration(page);
    await expect(page.getByRole('row').filter({ hasText: monitor.name })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: monitor.name }).getByRole('img', { name: 'In maintenance: alerts muted' })).toHaveCount(0);
  });

  test('a failing monitor inside a window stores maintenance results and opens no incident @high @positive @execution', async ({ projectAdminPage: page, cleanup }) => {
    test.skip(NO_WORKER, NO_WORKER_REASON);
    test.slow(); // Waits for two of the worker's scheduled checks.
    const request = page.request;
    const name = `E2E muted ${Date.now()}`;
    // Created paused, so no check runs before the window covers it. Always fails (example.com never answers 418);
    // incident-only alerts, so no channel is needed or notified.
    const monitor = await createMonitor(request, {
      name,
      enabled: false,
      frequencyMinutes: 1,
      config: { expectedStatusCodes: '418' },
      alertConfig: { enabled: true, notificationProviders: [], alertOnFailure: true, alertOnRecovery: true, failureThreshold: 1, recoveryThreshold: 1, incidentEnabled: true },
    });
    cleanup.add(`monitor ${monitor.id}`, () => deleteMonitor(request, monitor.id));

    // Scoped to this monitor only, so it never mutes another test's monitors.
    const start = new Date(Date.now() - 60_000);
    const created = await request.post('/api/maintenance-windows', {
      data: {
        title: `E2E mute ${Date.now()}`,
        scope: 'monitors',
        targets: { monitorIds: [monitor.id] },
        recurrence: 'once',
        timezone: 'UTC',
        localStartTime: start.toISOString().slice(11, 16),
        durationMinutes: 30,
        startsOn: start.toISOString().slice(0, 10),
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const windowId = ((await created.json()) as { window: { id: string } }).window.id;
    cleanup.add(`maintenance window ${windowId}`, async () => {
      // The monitor goes first, so it never fails outside the window.
      await deleteMonitor(request, monitor.id);
      await request.post(`/api/maintenance-windows/${windowId}/end`);
      const removed = await request.delete(`/api/maintenance-windows/${windowId}`);
      if (!removed.ok() && removed.status() !== 404) throw new Error(`Window cleanup failed: ${await removed.text()}`);
    });

    const resumed = await request.patch(`/api/monitors/${monitor.id}/status`, { data: { status: 'pending' } });
    expect(resumed.status(), await resumed.text()).toBe(200);

    // Two failing checks inside the window: the second runs a full interval after the first, which normally gives the
    // first failure ample time in triage. Best effort only: a muted failure leaves no record to wait on, by design, so
    // a triage backlog could let the assertion below pass early. background-alert-triage.db.spec.ts proves the
    // triage decision itself; this test proves the stored results, the badge and the end-to-end absence of an incident.
    await expect(async () => {
      const results = (await (await request.get(`/api/monitors/${monitor.id}/results?limit=10`)).json()) as { data: Array<{ isUp: boolean; inMaintenance?: boolean }> };
      expect(results.data.filter((r) => !r.isUp && r.inMaintenance === true).length).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 300_000, intervals: [10_000] });

    const listed = (await (await request.get('/api/sre/incidents')).json()) as { incidents: Array<{ title: string }> };
    expect(listed.incidents.filter((incident) => incident.title.includes(name))).toEqual([]);

    await page.goto(`/monitors/${monitor.id}`);
    await waitForHydration(page);
    await expect(page.getByTestId('result-maintenance-badge').first()).toBeVisible();
  });
});
