/**
 * Helpers for the docs and landing screenshot capture (docs-shots project).
 *
 * Runs only from .github/workflows/docs-shots.yml against the staging deployment, signed in
 * as the demo organization's owner. Navigation is read-only: dialogs are opened and left
 * without saving. The only server write is switching the session's active project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { settle, VOLATILE_IMAGES } from '../../utils/screenshot';
import { waitForHydration } from '../../utils/hydration';

/** Where images land. Mirrors docs/public/screenshots, so copying the folder replaces files in place. */
export const OUT_DIR = path.resolve(process.env.E2E_DOCS_SHOTS_OUT || path.join(__dirname, '../../docs-shots-output'));

/** Window sizes, in CSS pixels; the project sets deviceScaleFactor 2. */
export const DOCS_SIZE = { width: 1710, height: 1035 };
export const SRE_SIZE = { width: 1440, height: 900 };
/** Landing images are captured at the docs size and downscaled to 1600x969 by the workflow. */
export const LANDING_SIZE = DOCS_SIZE;

/** Host shown in place of the staging host, so frames read like production. */
const PUBLIC_ORIGIN = 'https://app.supercheck.io';

const hostOf = (url: string) => new URL(url).host.toLowerCase();

/**
 * Refuses to run unless the target is the staging deployment named by E2E_STAGING_BASE_URL.
 * Guards against the real captured data or a wrong target ending up in docs.
 */
export function assertStagingTarget(): { baseUrl: string; host: string } {
  const baseUrl = process.env.E2E_BASE_URL || '';
  const staging = process.env.E2E_STAGING_BASE_URL || '';
  if (!baseUrl || !staging) throw new Error('docs-shots needs E2E_BASE_URL and E2E_STAGING_BASE_URL');
  if (hostOf(baseUrl) !== hostOf(staging)) throw new Error('docs-shots only runs against the staging deployment');
  if (/(^|\.)supercheck\.io$/.test(hostOf(baseUrl))) throw new Error('docs-shots never runs against a supercheck.io host');
  return { baseUrl, host: hostOf(staging) };
}

/** Staging-only hostnames to hide: the app host plus the status-page domains the app reports. */
export async function stagingHosts(api: APIRequestContext, host: string): Promise<string[]> {
  const body: Record<string, unknown> = await api.get('/api/status-pages').then((r) => (r.ok() ? r.json() : {}));
  const extra = [body.statusPageDomain, body.statusPageCnameTarget].filter((h): h is string => typeof h === 'string' && !!h);
  return [...new Set([host, ...extra.map((h) => h.toLowerCase())])];
}

export type Ids = {
  monitor: string;
  heartbeatMonitor?: string;
  mcpMonitor?: string;
  playwrightTest?: string;
  k6Test?: string;
  agentTest?: string;
  job?: string;
  statusPage?: string;
  requirement?: string;
  incidentResolved?: string;
  incidentOpen?: string;
  service?: string;
  /** A synthetic monitor whose recent failed check has a saved report (the only case the report button shows). */
  reportMonitor?: string;
};

async function getJson(api: APIRequestContext, url: string): Promise<Record<string, unknown>> {
  const response = await api.get(url);
  expect(response.ok(), `${url} returned ${response.status()}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

type Row = { id?: string; type?: string; status?: string; name?: string; title?: string; isUp?: boolean; testExecutionId?: string; testReportS3Url?: string; details?: { reportUrl?: string } };
const rows = (body: Record<string, unknown>, key: string) => (body[key] as Row[] | undefined) ?? [];

/** Switches the session to the named project of the demo organization (a session-row update only). */
export async function useProject(page: Page, baseUrl: string, name: string): Promise<void> {
  const api = page.request;
  const projects = rows(await getJson(api, '/api/projects'), 'data');
  const project = projects.find((p) => p.name === name);
  expect(project?.id, `project "${name}" not found`).toBeTruthy();
  const response = await api.post('/api/projects/switch', { headers: { origin: baseUrl }, data: { projectId: project!.id } });
  expect(response.ok(), `switching to ${name} returned ${response.status()}`).toBe(true);
}

/** E2E runs leave records named "E2E …" behind; the showcase never picks one. */
export const isTestRecord = (row: { name?: string; title?: string }) => /\bE2E\b/i.test(`${row.name ?? ''} ${row.title ?? ''}`);

/** Looks up route ids in the active project through the API; optional records stay undefined. */
export async function lookupIds(api: APIRequestContext): Promise<Ids> {
  const real = (list: Row[]) => list.filter((r) => !isTestRecord(r));
  const monitors = real(rows(await getJson(api, '/api/monitors'), 'data'));
  const tests = real(rows(await getJson(api, '/api/tests?limit=100'), 'data'));
  const incidents = real(rows(await getJson(api, '/api/sre/incidents'), 'incidents'));
  const optional = async (url: string, key: string): Promise<Row[]> =>
    api.get(url).then(async (r) => (r.ok() ? rows((await r.json()) as Record<string, unknown>, key) : []));
  const [jobs, pages, requirements, services] = (await Promise.all([
    optional('/api/jobs', 'data'),
    optional('/api/status-pages', 'data'),
    optional('/api/requirements', 'data'),
    optional('/api/sre/services', 'services'),
  ])).map(real);
  const hasReport = (r: Row) => r.isUp === false && !!r.testExecutionId && !!(r.details?.reportUrl || r.testReportS3Url);
  let reportMonitor: string | undefined;
  for (const m of monitors.filter((m) => m.type === 'synthetic_test').slice(0, 10)) {
    // Newest first; the detail table shows only the first rows, so look at the latest 10.
    if ((await optional(`/api/monitors/${m.id}/results?limit=10`, 'data')).some(hasReport)) {
      reportMonitor = m.id;
      break;
    }
  }
  const byType = (list: Row[], type: string) => list.find((r) => r.type === type)?.id;
  const monitor = (monitors.find((m) => m.type === 'http_request') ?? monitors[0])?.id;
  expect(monitor, 'the project has no monitors').toBeTruthy();
  return {
    monitor: monitor!,
    heartbeatMonitor: byType(monitors, 'heartbeat'),
    mcpMonitor: byType(monitors, 'mcp_server'),
    playwrightTest: byType(tests, 'browser') ?? byType(tests, 'playwright'),
    k6Test: byType(tests, 'performance') ?? byType(tests, 'k6'),
    agentTest: byType(tests, 'agent'),
    job: jobs[0]?.id,
    statusPage: pages[0]?.id,
    requirement: requirements[0]?.id,
    incidentResolved: incidents.find((i) => i.status === 'resolved')?.id,
    incidentOpen: incidents.find((i) => i.status !== 'resolved')?.id,
    service: services[0]?.id,
    reportMonitor,
  };
}

/** Clicks the first visible tab, button, link, menu item, radio or text whose name matches; waits for it to render. */
export async function open(page: Page, name: RegExp): Promise<void> {
  const find = async () => {
    for (const role of ['tab', 'button', 'link', 'menuitem', 'radio'] as const) {
      const target = page.getByRole(role, { name }).first();
      if (await target.isVisible().catch(() => false)) return target;
    }
    const text = page.getByText(name).first();
    return (await text.isVisible().catch(() => false)) ? text : null;
  };
  await expect.poll(async () => (await find()) !== null, { message: `nothing to open for ${name}`, timeout: 15_000 }).toBe(true);
  await (await find())!.click();
  await settle(page);
}

/** Opens a page and fails if the app redirected somewhere else (for example to sign-in). */
export async function visit(page: Page, target: string): Promise<void> {
  const response = await page.goto(target);
  expect(response?.status() ?? 0, `${target} failed`).toBeLessThan(400);
  const landed = new URL(page.url());
  expect(landed.pathname + landed.search, `${target} redirected`).toBe(target);
  await waitForHydration(page);
}

/**
 * Replaces staging hostnames in visible text and field values (page and iframes) with the
 * production host, then fails if any is still on screen.
 */
export async function hideHost(page: Page, hosts: string[]): Promise<void> {
  const publicHost = new URL(PUBLIC_ORIGIN).host;
  for (const frame of page.frames()) {
    await frame.evaluate(
      ({ hosts, publicHost }) => {
        const escape = (h: string) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(hosts.map(escape).join('|'), 'gi');
        const swap = (s: string) => s.replace(re, publicHost);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeValue && re.test(n.nodeValue)) n.nodeValue = swap(n.nodeValue);
          re.lastIndex = 0;
        }
        for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
          const field = el as HTMLInputElement;
          if (re.test(field.value)) field.value = swap(field.value);
          re.lastIndex = 0;
        }
      },
      { hosts, publicHost },
    ).catch(() => undefined);
    const leaked = await frame
      .evaluate(
        (hosts) => {
          const has = (t: string) => hosts.some((h) => t.toLowerCase().includes(h));
          return has(document.body.innerText) || Array.from(document.querySelectorAll('input, textarea')).some((el) => has((el as HTMLInputElement).value));
        },
        hosts,
      )
      .catch(() => false);
    expect(leaked, 'a staging host is still visible in the frame').toBe(false);
  }
}

export type Output = { file: string; size: { width: number; height: number } };

/** Saves one frame per output. `.webp` files are written as `<name>.webp.png` masters for the workflow to convert. */
export async function capture(page: Page, hosts: string[], outputs: Output[]): Promise<void> {
  for (const { file, size } of outputs) {
    await page.setViewportSize(size);
    await settle(page);
    await hideHost(page, hosts);
    const target = path.join(OUT_DIR, file.endsWith('.webp') ? `${file}.png` : file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, animations: 'disabled', caret: 'hide', scale: 'device', mask: [page.locator(VOLATILE_IMAGES)], maskColor: '#9ca3af' });
  }
}
