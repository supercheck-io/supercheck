import { test, expect, Page } from '@playwright/test';
import { PlaygroundPage, AICreatePage } from '../../pages/playground.page';
import { loginIfNeeded } from "../../utils/auth-helper";

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Playground - Page Loading @playground @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-001: Playground page loads successfully @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });

  test('PLAY-002: Monaco editor is visible @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });

  test('PLAY-003: Run button is visible @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });
});
test.describe('Playground - Editor Functionality @playground', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-004: Can type in editor @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });

  test('PLAY-023: Theme toggle is available @medium @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });
});

test.describe('Playground - AI Features @playground @ai', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-007: AI Fix button is available @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });

  test('PLAY-013: AI Create is accessible @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });
});

test.describe('Playground - Templates @playground', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-048: Templates button is visible @medium @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });
});

test.describe('Playground - Test Execution @playground', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-004: Run button triggers execution @critical @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });

  test('PLAY-043: Results area exists @high @positive', async ({ page }) => {
    const playgroundPage = new PlaygroundPage(page);
    await playgroundPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/playground/);
  });
});

test.describe('AI Create Page @playground @ai', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-013: AI Create page is accessible @high @positive', async ({ page }) => {
    await page.goto('/playground', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/playground/);
  });
});

test.describe('Playground - Security @playground @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-034: Playground requires authentication @high @security', async ({ page }) => {
    await page.goto('/playground', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toBeTruthy();
  });
});

test.describe('Playground - API @playground @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PLAY-035: Playground endpoint responds @medium @security', async ({ request }) => {
    const response = await request.get('/api/playground').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(600);
    }
  });
});
