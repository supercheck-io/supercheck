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

const ORG = '/org-admin';
const SHOTS: Record<string, Shot> = {
  // Batch 1 (P1): landing and highest drift.
  dashboard: { files: ['dashboard.png', 'site/dashboard.webp', 'supercheck-screenshot.webp'], go: at('/') },
  'monitors-list': { files: ['monitors-list.png', 'site/monitors-list.webp'], go: at('/monitors') },
  'monitor-details': { files: ['monitor-details.png', 'site/monitor-details.webp'], go: at(id((v) => `/monitors/${v}`, 'monitor')) },
  'monitor-report': { files: ['monitor-report.png'], go: then(id((v) => `/monitors/${v}`, 'monitor'), /report/i) },
  'incident-workspace-overview': { files: ['incident-workspace-overview.png', 'site/incident-workspace-overview.webp'], sre: true, go: at(id((v) => `/incidents/${v}`, 'incidentResolved')) },
  'incident-evidence-brief': { files: ['incident-evidence-brief.png'], sre: true, go: then(id((v) => `/incidents/${v}`, 'incidentResolved'), /evidence|brief/i) },
  'incident-postmortem': { files: ['incident-postmortem.png'], sre: true, go: then(id((v) => `/incidents/${v}`, 'incidentResolved'), /post-?mortem/i) },
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
  'status-page-create-incident': { files: ['status-page-create-incident.png', 'site/status-page-create-incident.webp'], go: then('/incidents', /declare incident|create incident|new incident/i) },

  // Batch 2 (P1): forms and new features.
  'create-http-monitor': { files: ['create-http-monitor.png', 'site/create-http-monitor.webp'], go: then('/monitors/create', /http request/i) },
  'create-website-monitor': { files: ['create-website-monitor.png'], go: then('/monitors/create', /website/i) },
  'create-ping-monitor': { files: ['create-ping-monitor.png'], go: then('/monitors/create', /ping/i) },
  'create-port-monitor': { files: ['create-port-monitor.png'], go: then('/monitors/create', /port/i) },
  'create-synthetic-monitor': { files: ['create-synthetic-monitor.png', 'site/create-synthetic-monitor.webp'], go: then('/monitors/create', /synthetic/i) },
  'create-monitor-alerts-setting': { files: ['create-monitor-alerts-setting.png'], go: then('/monitors/create', /http request/i, /alerts?/i) },
  'notification-channels': { files: ['notification-channels.png', 'site/notification-channels.webp'], sre: true, go: at('/notifications') },
  'alert-history': { files: ['alert-history.png'], sre: true, go: at('/notifications?tab=history') },
  // New images, no existing file to replace (names chosen for the docs pages that lack a screenshot).
  'heartbeat-monitor-details': { files: ['heartbeat-monitor-details.png'], go: at(id((v) => `/monitors/${v}`, 'heartbeatMonitor')) },
  'mcp-monitor-details': { files: ['mcp-monitor-details.png'], go: at(id((v) => `/monitors/${v}`, 'mcpMonitor')) },
  'create-heartbeat-monitor': { files: ['create-heartbeat-monitor.png'], go: at('/monitors/create?type=heartbeat') },
  'create-ai-endpoint-monitor': { files: ['create-ai-endpoint-monitor.png'], go: at('/monitors/create?type=ai_endpoint') },
  'create-mcp-monitor': { files: ['create-mcp-monitor.png'], go: then('/monitors/create', /mcp/i) },
  'maintenance-windows': { files: ['maintenance-windows.png'], go: then('/monitors', /maintenance/i) },
  'notification-channel-dialog': { files: ['notification-channel-dialog.png'], go: then('/notifications', /add (a )?(notification )?(channel|provider)|new (channel|provider)/i) },
  'agent-test-editor': { files: ['agent-test-editor.png'], go: at(id((v) => `/playground/${v}`, 'agentTest')) },
  'project-setup': { files: ['project-setup.png'], go: at('/setup') },
  'project-setup-welcome': { files: ['project-setup-welcome.png'], go: at('/setup/welcome') },

  // Batch 3 (P2): chrome drift.
  'jobs-list': { files: ['jobs-list.png'], go: at('/jobs') },
  'job-runs': { files: ['job-runs.png'], go: at('/runs') },
  'create-job-form': { files: ['create-job-form.png'], go: at('/jobs/create') },
  'tests-list': { files: ['tests-list.png'], go: at('/tests') },
  'playground-editor': { files: ['playground-editor.png', 'site/playground-editor.webp'], go: at(id((v) => `/playground/${v}`, 'playwrightTest')) },
  'playground-report': { files: ['playground-report.png'], go: then(id((v) => `/playground/${v}`, 'playwrightTest'), /report/i) },
  'performance-test-editor': { files: ['performance-test-editor.png'], go: at(id((v) => `/playground/${v}`, 'k6Test')) },
  'performance-test-report': { files: ['performance-test-report.png'], go: then(id((v) => `/playground/${v}`, 'k6Test'), /report/i) },
  'dashboard-k6-analytics': { files: ['dashboard-k6-analytics.png'], go: at(id((v) => `/runs/${v}`, 'runK6')) },
  'dashboard-k6-compare-dialog': { files: ['dashboard-k6-compare-dialog.png'], go: then(id((v) => `/runs/${v}`, 'runK6'), /compare/i) },
  'dashboard-playwright-analytics': { files: ['dashboard-playwright-analytics.png'], go: at(id((v) => `/runs/${v}`, 'runFailed')) },
  'requirements-list': { files: ['requirements-list.png', 'site/requirements-list.webp'], go: at('/requirements') },
  'quick-create': { files: ['quick-create.png'], go: at('/create') },
  'sre-services-catalog': { files: ['sre-services-catalog.png'], go: at('/services') },
  'sre-service-detail': { files: ['sre-service-detail.png'], sre: true, go: at(id((v) => `/services/${v}`, 'service')) },
  'sre-add-service-dialog': { files: ['sre-add-service-dialog.png'], go: then('/services', /add service|new service/i) },
  'sre-add-connector-dialog': { files: ['sre-add-connector-dialog.png', 'site/sre-add-connector-dialog.webp'], go: then(`${ORG}?tab=integrations`, /add (a )?(connector|integration)|new (connector|integration)/i) },
  'sre-integrations-saved-queries': { files: ['sre-integrations-saved-queries.png'], go: at(`${ORG}?tab=integrations&section=saved-queries`) },
  'status-pages-list': { files: ['status-pages-list.png'], go: at('/status-pages') },
  'status-page-create': { files: ['status-page-create.png'], go: then('/status-pages', /create status page|new status page|create/i) },
  'status-page-overview': { files: ['status-page-overview.png'], go: at(id((v) => `/status-pages/${v}`, 'statusPage')) },
  'status-page-components': { files: ['status-page-components.png', 'site/status-page-components.webp'], go: then(id((v) => `/status-pages/${v}`, 'statusPage'), /components/i) },
  'status-page-add-component': { files: ['status-page-add-component.png'], go: then(id((v) => `/status-pages/${v}`, 'statusPage'), /components/i, /add component/i) },
  'status-page-incidents': { files: ['status-page-incidents.png'], go: then(id((v) => `/status-pages/${v}`, 'statusPage'), /incidents/i) },
  'status-page-subscribers': { files: ['status-page-subscribers.png'], go: then(id((v) => `/status-pages/${v}`, 'statusPage'), /subscribers/i) },
  'status-page-settings': { files: ['status-page-settings.png'], go: then(id((v) => `/status-pages/${v}`, 'statusPage'), /settings/i) },
  'org-admin-overview': { files: ['org-admin-overview.png'], go: at(ORG) },
  'org-admin-projects': { files: ['org-admin-projects.png'], go: then(ORG, /projects/i) },
  'org-admin-create-project': { files: ['org-admin-create-project.png'], go: then(ORG, /projects/i, /create project|new project/i) },
  'org-admin-audit-list': { files: ['org-admin-audit-list.png'], go: then(ORG, /audit/i) },
  'org-admin-member-invite-dialog': { files: ['org-admin-member-invite-dialog.png', 'site/org-admin-member-invite-dialog.webp'], go: then(ORG, /members/i, /invite/i) },
  'org-admin-private-agents': { files: ['org-admin-private-agents.png'], go: at(`${ORG}?tab=private-agents`) },
  'connected-apps': { files: ['connected-apps.png'], go: at('/connected-apps') },
  'variables-list': { files: ['variables-list.png'], go: at('/variables') },
  'add-variable': { files: ['add-variable.png'], go: then('/variables', /add variable|new variable/i) },
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
      if (!idsByProject.has(project)) idsByProject.set(project, lookupIds(page.request));
      await shot.go({ page, ids: await (idsByProject.get(project) as Promise<Ids>) });
      const outputs: Output[] = shot.files.map((file) => ({ file, size: file.endsWith('.webp') ? LANDING_SIZE : shot.sre ? SRE_SIZE : DOCS_SIZE }));
      await capture(page, await stagingHosts(page.request, host), outputs);
    });
  }
});
