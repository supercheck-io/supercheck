import { expect, test } from '@playwright/test';
import { parse } from '../../src/server/recorder/parser';

const source = (options: string) => `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.routeFromHAR('har.har'${options});
});`;

// Playwright's recordHar option is `urlFilter`; `urlGlob` is silently ignored,
// which would record every request (including secrets) instead of the filtered set.
test('routeFromHAR url filter is emitted as recordHar.urlFilter', () => {
  const [parsed] = parse(source(`, { url: '**/*.js' }`));
  const recordHar = parsed.options?.contextOptions?.recordHar as Record<string, unknown>;
  expect(recordHar.urlFilter).toBe('**/*.js');
  expect(recordHar).not.toHaveProperty('urlGlob');
});

test('routeFromHAR without a url leaves the filter unset', () => {
  const [parsed] = parse(source(''));
  const recordHar = parsed.options?.contextOptions?.recordHar as Record<string, unknown>;
  expect(recordHar.urlFilter).toBeUndefined();
});
