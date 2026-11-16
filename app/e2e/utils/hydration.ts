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
        // The root layout sets the flag before streamed page chunks load; a click on a
        // not-yet-hydrated segment is dropped, so also wait for every script ("load").
        page.evaluate(
          () =>
            document.readyState === "complete" &&
            document.documentElement.dataset.hydrated === "true",
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}
