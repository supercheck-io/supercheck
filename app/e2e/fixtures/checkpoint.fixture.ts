/**
 * Visual checkpoints for the PR screenshot gallery.
 *
 * With E2E_CHECKPOINTS=1 (set only by .github/workflows/pr-screenshots.yml against its
 * throwaway app), every browser test saves the screen it ended on as a checkpoint, and a
 * failing test saves `failed-…` instead. `checkpoint(page, 'step')` adds frames mid-flow.
 * Each frame gets a `<name>.checkpoint.json` sidecar naming the spec and test, which the
 * gallery shows on its card. Off by default, so runs against real deployments never write them.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as base, type Page, type TestInfo } from '@playwright/test';
import { normalizeVolatileText, restoreVolatileText, settle, VOLATILE_IMAGES } from '../utils/screenshot';

const ENABLED = process.env.E2E_CHECKPOINTS === '1';
const TESTS_DIR = path.resolve(__dirname, '../tests');

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Gallery-safe, run-stable frame name: readable prefix plus a hash of the full test path. */
function frameName(testInfo: TestInfo, step: string, failed: boolean): string {
  const spec = path.relative(TESTS_DIR, testInfo.file).replace(/\.spec\.ts$/, '');
  const id = createHash('sha1').update([spec, ...testInfo.titlePath, step].join('\u0000')).digest('hex').slice(0, 6);
  // `end` and `failure` frames are named after the test alone.
  const readable = slug(step === 'end' || step === 'failure' ? testInfo.title : `${testInfo.title} ${step}`) || 'test';
  // The gallery accepts 100 characters before `.png`.
  return `${failed ? 'failed-' : ''}${readable}`.slice(0, 92).replace(/-$/, '') + `-${id}`;
}

async function save(page: Page, testInfo: TestInfo, step: string, failed: boolean): Promise<void> {
  if (page.isClosed() || page.url() === 'about:blank') return;
  const name = frameName(testInfo, step, failed);
  const file = testInfo.outputPath(`${name}.png`);
  if (!failed) {
    // Let the page settle and swap run-specific text, so unchanged screens hash the same.
    await settle(page);
    await normalizeVolatileText(page).catch(() => undefined);
  }
  const saved = await page
    .screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 10_000, mask: [page.locator(VOLATILE_IMAGES)], maskColor: '#9ca3af' })
    .then(() => true, () => false);
  if (!failed) await restoreVolatileText(page).catch(() => undefined);
  if (!saved) return;
  const spec = path.relative(TESTS_DIR, testInfo.file);
  await writeFile(
    testInfo.outputPath(`${name}.checkpoint.json`),
    JSON.stringify({
      // Title tags such as `@high` are noise on a card; `@negative` marks a test of refused input or access.
      title: testInfo.titlePath.slice(1).join(' › ').replace(/(\s+@[\w-]+)+(?= ›|$)/g, ''),
      step,
      spec,
      area: spec.split(path.sep)[0],
      negative: testInfo.tags.includes('@negative'),
    }),
  );
}

/**
 * Saves the end (or failure) frame of a page a fixture opened itself, such as a role's
 * signed-in page. Call it before the fixture closes that page's context; the automatic
 * checkpoint only sees the default `page`.
 */
export async function captureFixturePage(page: Page, label: string): Promise<void> {
  if (!ENABLED) return;
  const info = base.info();
  if (info.status === 'skipped') return;
  const failed = info.status !== info.expectedStatus;
  await save(page, info, failed ? `${label} failure` : label, failed);
}

/**
 * True in the screenshot app, which runs without a worker: specs that need a run to
 * execute skip there with `test.skip(NO_WORKER, NO_WORKER_REASON)` and still run everywhere else.
 */
export const NO_WORKER = ENABLED;
export const NO_WORKER_REASON = 'the PR screenshot app has no worker to execute runs';

/** Saves a named mid-flow frame. A no-op unless checkpoints are on. */
export async function checkpoint(page: Page, step: string): Promise<void> {
  if (ENABLED) await save(page, base.info(), step, false);
}

export const test = base.extend<{ _checkpoint: void }>({
  _checkpoint: [
    async ({ page }, use, testInfo) => {
      await use();
      if (!ENABLED || testInfo.status === 'skipped') return;
      const failed = testInfo.status !== testInfo.expectedStatus;
      await save(page, testInfo, failed ? 'failure' : 'end', failed);
    },
    // Only automatic when on, so suites against real deployments open no extra page.
    { auto: ENABLED },
  ],
});

export { expect } from '@playwright/test';
