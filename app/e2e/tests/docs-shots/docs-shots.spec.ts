/**
 * Docs and landing screenshot capture, project `docs-shots`.
 *
 * Runs only from .github/workflows/docs-shots.yml, against staging, as the demo organization's
 * owner (auth.setup.ts signs in with the credentials the workflow maps to E2E_TEST_USER_*).
 * Each shot is named exactly like the image it replaces under docs/public/screenshots, so
 * copying the output folder over that folder shows up as in-place replacements in a PR.
 * Dark theme, real dates. A `.webp` file is a landing image: saved as a PNG master and
 * converted to 1600x969 WebP by the workflow.
 *
 * Not covered: frames that route navigation cannot produce (alert, invite and Slack renders),
 * billed AI dialogs, and super-admin pages (a different identity).
 */
import { test, expect, type Page } from '@playwright/test';
import { assertStagingTarget, capture, DOCS_SIZE, LANDING_SIZE, lookupIds, open, SRE_SIZE, stagingHosts, useProject, visit, type Ids, type Output } from './lib';
import { seedShowcase } from './seed';

type Ctx = { page: Page; ids: Ids };
type Shot = {
  /** Output files relative to docs/public/screenshots; `.webp` ones are landing images. */
  files: string[];
  /** Demo project to capture from. Storefront unless a second project helps. */
  project?: 'Storefront' | 'Checkout Platform';
  /** The nine SRE frames keep their existing 1440x900 window (2880x1800). */
  sre?: boolean;
  go: (c: Ctx) => Promise<void>;
};

const at = (route: string | ((ids: Ids) => string | undefined)) => async ({ page, ids }: Ctx) => {
  const target = typeof route === 'string' ? route : route(ids);
  expect(target, `no record to open for ${String(route)}`).toBeTruthy();
  await visit(page, target as string);
};
const then = (route: Parameters<typeof at>[0], ...steps: RegExp[]) => async (c: Ctx) => {
  await at(route)(c);
  for (const step of steps) await open(c.page, step);
};
const id = (build: (value: string) => string, key: keyof Ids) => (ids: Ids) => (ids[key] ? build(ids[key] as string) : undefined);

// Opens a playground test, runs it once and waits for the runner to switch to the Report tab with the report loaded.
const runForReport = (route: Parameters<typeof at>[0]) => async (c: Ctx) => {
  test.setTimeout(300_000); // execution (up to 3 min) plus report load and capture
  await at(route)(c);
  const running = c.page.getByRole('button', { name: /running/i });
  const location = c.page.getByRole('dialog', { name: 'Select Execution Location' });
  const validating = c.page.getByRole('button', { name: /validating/i });
  // k6 Run only toasts "Loading locations…" until locations load, so retry the click,
  // but never while an earlier click is still validating or has already started.
  await expect(async () => {
    if (await running.isVisible()) return;
    if (!(await location.isVisible()) && !(await validating.isVisible())) {
      await c.page.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 5_000 });
    }
    // k6 tests ask for a location first when the project has more than one.
    if (await location.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) {
      await location.getByRole('button', { name: 'Run Test' }).click();
    }
    await expect(running).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(running).toHaveCount(0, { timeout: 180_000 });
  await expect(c.page.frameLocator('iframe').first().locator('body')).not.toBeEmpty({ timeout: 60_000 });
};

const ORG = '/org-admin';
const SHOTS: Record<string, Shot> = {
  // Batch 1 (P1): landing and highest drift.
  dashboard: { files: ['dashboard.png', 'site/dashboard.webp', 'supercheck-screenshot.webp'], go: at('/') },
  'monitors-list': { files: ['monitors-list.png', 'site/monitors-list.webp'], go: at('/monitors') },
  'monitor-details': { files: ['monitor-details.png', 'site/monitor-details.webp'], go: at(id((v) => `/monitors/${v}`, 'monitor')) },
  'monitor-report': { files: ['monitor-report.png'], go: async ({ page, ids }) => {
    // The report button shows only on a failed synthetic check with a saved report.
    test.skip(!ids.reportMonitor, 'no synthetic monitor has a failed check with a saved report');
    await visit(page, `/monitors/${ids.reportMonitor}`);
    const button = page.getByRole('button', { name: 'View test report' }).first();
    const shown = await button.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    test.skip(!shown, 'the failed check is not on the first page of results');
    await button.click();
    await expect(page.frameLocator('iframe').getByText(/total time/i)).toBeVisible({ timeout: 30_000 });
  } },
  'incident-workspace-overview': { files: ['incident-workspace-overview.png', 'site/incident-workspace-overview.webp'], sre: true, go: at(id((v) => `/incidents/${v}`, 'incidentResolved')) },
  'incident-evidence-brief': { files: ['incident-evidence-brief.png'], sre: true, go: at(id((v) => `/incidents/${v}?tab=investigation`, 'incidentResolved')) },
  'incident-postmortem': { files: ['incident-postmortem.png'], sre: true, go: at(id((v) => `/incidents/${v}?tab=postmortem`, 'incidentResolved')) },
  'sre-incidents-queue': { files: ['sre-incidents-queue.png'], sre: true, go: at('/incidents') },
  'sre-incident-trends': { files: ['sre-incident-trends.png'], sre: true, go: at('/incidents/analytics') },
  'sre-copilot-chat': { files: ['sre-copilot-chat.png', 'site/sre-copilot-chat.webp'], sre: true, go: at('/copilot') },
  'status-page-external': { files: ['status-page-external.png', 'site/status-page-public.webp'], go: at(id((v) => `/status-pages/${v}/public`, 'statusPage')) },
  'status-page-incident-external': {
    files: ['status-page-incident-external.png'],
    go: async (c) => {
      await at(id((v) => `/status-pages/${v}/public`, 'statusPage'))(c);
      // The public incident page id is not in any list API, so follow the first incident link.
      const link = c.page.locator('a[href*="/incidents/"]').first();
      await expect(link, 'the public status page lists no incident').toBeVisible();
      await link.click();
      await c.page.waitForURL(/\/incidents\//);
      await c.page.waitForLoadState('domcontentloaded');
    },
  },
  'status-page-create-incident': { files: ['status-page-create-incident.png', 'site/status-page-create-incident.webp'], go: then(id((v) => `/status-pages/${v}?tab=incidents`, 'statusPage'), /new status update/i) },

  // Batch 2 (P1): forms and new features.
  'create-http-monitor': { files: ['create-http-monitor.png', 'site/create-http-monitor.webp'], go: at('/monitors/create?type=http_request') },
  'create-website-monitor': { files: ['create-website-monitor.png'], go: at('/monitors/create?type=website') },
  'create-ping-monitor': { files: ['create-ping-monitor.png'], go: at('/monitors/create?type=ping_host') },
  'create-port-monitor': { files: ['create-port-monitor.png'], go: at('/monitors/create?type=port_check') },
  'create-synthetic-monitor': { files: ['create-synthetic-monitor.png', 'site/create-synthetic-monitor.webp'], go: at('/monitors/create?type=synthetic_test') },
  'create-monitor-alerts-setting': { files: ['create-monitor-alerts-setting.png'], go: async (c) => {
    await at('/monitors/create?type=http_request&wizardStep=alerts')(c);
    const alerts = c.page.getByRole('switch', { name: /enable alerts/i });
    await expect(alerts).toBeVisible();
    if ((await alerts.getAttribute('aria-checked')) !== 'true') await alerts.click();
  } },
  'notification-channels': { files: ['notification-channels.png', 'site/notification-channels.webp'], sre: true, go: at('/notifications') },
  'alert-history': { files: ['alert-history.png'], sre: true, go: at('/notifications?tab=history') },
  // New images, no existing file to replace (names chosen for the docs pages that lack a screenshot).
  'heartbeat-monitor-details': { files: ['heartbeat-monitor-details.png'], go: at(id((v) => `/monitors/${v}`, 'heartbeatMonitor')) },
  'mcp-monitor-details': { files: ['mcp-monitor-details.png'], go: at(id((v) => `/monitors/${v}`, 'mcpMonitor')) },
  'create-heartbeat-monitor': { files: ['create-heartbeat-monitor.png'], go: at('/monitors/create?type=heartbeat') },
  'create-ai-endpoint-monitor': { files: ['create-ai-endpoint-monitor.png'], go: at('/monitors/create?type=ai_endpoint') },
  'create-mcp-monitor': { files: ['create-mcp-monitor.png'], go: at('/monitors/create?type=mcp_server') },
  'maintenance-windows': { files: ['maintenance-windows.png'], go: at('/monitors?tab=maintenance') },
  'notification-channel-dialog': { files: ['notification-channel-dialog.png'], go: at('/notifications?create=true') },
  'agent-test-editor': { files: ['agent-test-editor.png'], go: at(id((v) => `/playground/${v}`, 'agentTest')) },
  'project-setup': { files: ['project-setup.png'], go: at('/setup') },
  'project-setup-welcome': { files: ['project-setup-welcome.png'], go: at('/setup/welcome') },

  // Batch 3 (P2): chrome drift.
  'jobs-list': { files: ['jobs-list.png'], go: at('/jobs') },
  'job-runs': { files: ['job-runs.png'], go: at('/runs') },
  'create-job-form': { files: ['create-job-form.png'], go: at('/jobs/create/playwright') },
  'tests-list': { files: ['tests-list.png'], go: at('/tests') },
  'playground-editor': { files: ['playground-editor.png', 'site/playground-editor.webp'], go: at(id((v) => `/playground/${v}`, 'playwrightTest')) },
  'playground-report': { files: ['playground-report.png'], go: runForReport(id((v) => `/playground/${v}`, 'playwrightTest')) },
  'performance-test-editor': { files: ['performance-test-editor.png'], go: at(id((v) => `/playground/${v}`, 'k6Test')) },
  'performance-test-report': { files: ['performance-test-report.png'], go: runForReport(id((v) => `/playground/${v}`, 'k6Test')) },
  'dashboard-k6-analytics': { files: ['dashboard-k6-analytics.png'], go: at('/runs?view=k6') },
  'dashboard-k6-compare-dialog': { files: ['dashboard-k6-compare-dialog.png'], go: then('/runs?view=k6', /compare runs/i) },
  'dashboard-playwright-analytics': { files: ['dashboard-playwright-analytics.png'], go: at('/runs?view=playwright') },
  'requirements-list': { files: ['requirements-list.png', 'site/requirements-list.webp'], go: at('/requirements') },
  'quick-create': { files: ['quick-create.png'], go: at('/create') },
  'sre-services-catalog': { files: ['sre-services-catalog.png'], go: at('/services') },
  'sre-service-detail': { files: ['sre-service-detail.png'], sre: true, go: at(id((v) => `/services/${v}`, 'service')) },
  'sre-add-service-dialog': { files: ['sre-add-service-dialog.png'], go: then('/services', /add service/i) },
  'sre-add-connector-dialog': { files: ['sre-add-connector-dialog.png', 'site/sre-add-connector-dialog.webp'], go: then(`${ORG}?tab=integrations`, /add connector/i) },
  'sre-integrations-saved-queries': { files: ['sre-integrations-saved-queries.png'], go: at(`${ORG}?tab=integrations&section=saved-queries`) },
  'status-pages-list': { files: ['status-pages-list.png'], go: at('/status-pages') },
  'status-page-create': { files: ['status-page-create.png'], go: at('/status-pages?create=true') },
  'status-page-overview': { files: ['status-page-overview.png'], go: at(id((v) => `/status-pages/${v}`, 'statusPage')) },
  'status-page-components': { files: ['status-page-components.png', 'site/status-page-components.webp'], go: at(id((v) => `/status-pages/${v}?tab=components`, 'statusPage')) },
  'status-page-add-component': { files: ['status-page-add-component.png'], go: then(id((v) => `/status-pages/${v}?tab=components`, 'statusPage'), /add component/i) },
  'status-page-incidents': { files: ['status-page-incidents.png'], go: at(id((v) => `/status-pages/${v}?tab=incidents`, 'statusPage')) },
  'status-page-subscribers': { files: ['status-page-subscribers.png'], go: at(id((v) => `/status-pages/${v}?tab=subscribers`, 'statusPage')) },
  'status-page-settings': { files: ['status-page-settings.png'], go: at(id((v) => `/status-pages/${v}?tab=settings`, 'statusPage')) },
  // /org-admin has no overview tab; its landing view (Projects) is the frame the docs use as the overview.
  'org-admin-overview': { files: ['org-admin-overview.png'], go: at(ORG) },
  'org-admin-projects': { files: ['org-admin-projects.png'], go: at(`${ORG}?tab=projects`) },
  'org-admin-create-project': { files: ['org-admin-create-project.png'], go: then(`${ORG}?tab=projects`, /create project/i) },
  'org-admin-audit-list': { files: ['org-admin-audit-list.png'], go: at(`${ORG}?tab=audit`) },
  'org-admin-member-invite-dialog': { files: ['org-admin-member-invite-dialog.png', 'site/org-admin-member-invite-dialog.webp'], go: then(`${ORG}?tab=members`, /invite member/i) },
  'org-admin-private-agents': { files: ['org-admin-private-agents.png'], go: at(`${ORG}?tab=private-agents`) },
  'connected-apps': { files: ['connected-apps.png'], go: at('/connected-apps') },
  'variables-list': { files: ['variables-list.png'], go: at('/variables') },
  'add-variable': { files: ['add-variable.png'], go: at('/variables?create=true') },
};

const idsByProject = new Map<string, Promise<Ids>>();

test.describe('docs screenshots', () => {
  test.beforeAll(() => {
    assertStagingTarget();
  });

  for (const [name, shot] of Object.entries(SHOTS)) {
    test(name, async ({ page }) => {
      const { baseUrl, host } = assertStagingTarget();
      const project = shot.project ?? 'Storefront';
      await useProject(page, baseUrl, project);
      if (!idsByProject.has(project)) {
        // The first shot of a project seeds what the showcase lacks, then looks up the route ids.
        test.setTimeout(300_000);
        const seed = project === 'Storefront' ? seedShowcase(page, baseUrl) : Promise.resolve();
        idsByProject.set(project, seed.then(() => lookupIds(page.request)));
      }
      await shot.go({ page, ids: await (idsByProject.get(project) as Promise<Ids>) });
      const outputs: Output[] = shot.files.map((file) => ({ file, size: file.endsWith('.webp') ? LANDING_SIZE : shot.sre ? SRE_SIZE : DOCS_SIZE }));
      await capture(page, await stagingHosts(page.request, host), outputs);
    });
  }
});
