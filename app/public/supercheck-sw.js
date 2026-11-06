/**
 * Retired Supercheck service worker.
 *
 * A root-scoped worker controlled the in-app report iframes, so the Playwright
 * trace viewer saw an existing controller, skipped waiting for its own worker
 * and sent `trace/contexts` to the network ("Object not found").
 *
 * Browsers that installed the old worker fetch this file on their next update
 * check. It removes its caches and unregisters itself. Keep this file served
 * at this URL: a 404 would leave the old worker installed.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("supercheck-"))
            .map((name) => caches.delete(name))
        )
      )
      // Unregister even if cache cleanup fails: staying installed is the bug.
      .catch(() => {})
      .then(() => self.registration.unregister())
  );
});
