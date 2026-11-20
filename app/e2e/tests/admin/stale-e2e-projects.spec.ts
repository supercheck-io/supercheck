import { expect } from '@playwright/test';
import { test } from '../../fixtures';

/**
 * Specs that create an isolated project delete it in a finally block, but a run cut off mid-test
 * (an origin outage, a cancelled job) leaves the project behind, where it shows in the
 * organization's project list. This sweep soft-deletes only those leftovers:
 * - the name is an E2E spec's: "E2E …" ending in a Date.now() stamp
 * - the stamp is more than STALE_MS old, so a run in progress is never touched
 * - never the default project
 * Soft-deleted projects stay restorable for 7 days.
 */
const E2E_PROJECT = /^E2E\b.*\s(\d{13})$/;
const STALE_MS = 2 * 60 * 60 * 1000;

function staleE2eProjects<T extends { name?: string; isDefault?: boolean }>(projects: T[], now: number): T[] {
  return projects.filter((p) => {
    const stamp = E2E_PROJECT.exec(p.name ?? '')?.[1];
    return !p.isDefault && !!stamp && now - Number(stamp) > STALE_MS;
  });
}

test.describe('E2E hygiene @maintenance', () => {
  test('picks only stale, non-default E2E projects', () => {
    const now = Date.UTC(2026, 10, 20, 12);
    const old = now - STALE_MS - 1;
    const projects = [
      { name: `E2E Private Agent ${old}` },
      { name: `E2E Private Agent ${now - 60_000}` }, // a run in progress
      { name: `E2E default ${old}`, isDefault: true },
      { name: 'Storefront' },
      { name: `Storefront ${old}` },
      { name: `My E2E checks ${old}` },
    ];
    expect(staleE2eProjects(projects, now).map((p) => p.name)).toEqual([`E2E Private Agent ${old}`]);
  });

  test('soft-deletes projects left behind by interrupted E2E runs', async ({ orgOwnerPage: page }) => {
    const response = await page.request.get('/api/projects');
    expect(response.ok(), await response.text()).toBe(true);
    const { data = [], currentProject } = (await response.json()) as {
      data?: Array<{ id: string; name?: string; isDefault?: boolean; organizationId?: string }>;
      currentProject?: { organizationId?: string };
    };
    // Only the active organization: the list can include other teams' projects the owner can merely view.
    const orgId = currentProject?.organizationId;
    expect(orgId, 'the org owner has no active organization').toBeTruthy();
    const stale = staleE2eProjects(data.filter((p) => p.organizationId === orgId), Date.now());
    let swept = 0;
    for (const project of stale) {
      const removed = await page.request.delete(`/api/projects/${project.id}`);
      // 403: not ours to delete, so leave it. Anything else unexpected fails the sweep.
      expect([200, 204, 403, 404], `deleting ${project.name}: ${await removed.text()}`).toContain(removed.status());
      if (removed.ok()) swept++;
    }
    test.info().annotations.push({ type: 'swept', description: `${swept} of ${stale.length} stale E2E project(s)` });
  });
});
