import { expect, type Page } from "@playwright/test";

/**
 * Wait until the client tree has hydrated.
 *
 * `page.goto(..., { waitUntil: "load" })` resolves before React attaches its
 * event handlers on a cold page load; a click dispatched in that window is
 * silently dropped. Wait for the `data-hydrated` flag set by
 * `HydrationReady` before clicking anything on a freshly loaded page.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.dataset.hydrated === "true",
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
