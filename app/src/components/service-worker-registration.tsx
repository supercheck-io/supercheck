"use client";

import { useEffect } from "react";

const RETIRED_SW_PATH = "/supercheck-sw.js";

function isRetiredWorker(registration: ServiceWorkerRegistration): boolean {
  const worker =
    registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) return false;
  try {
    return new URL(worker.scriptURL).pathname === RETIRED_SW_PATH;
  } catch {
    return false;
  }
}

/**
 * Removes the retired root-scoped app service worker. While installed it
 * controlled report iframes and broke the Playwright trace viewer, which needs
 * its own worker under `/api/test-results/.../trace/`. Only the retired worker
 * is removed; trace viewer workers on this origin are left alone.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(
          registrations
            .filter(isRetiredWorker)
            .map((registration) => registration.unregister())
        )
      )
      .catch(() => {
        // Best effort: the retired worker also unregisters itself on update.
      });
    // Unregistering here means the worker's own cache cleanup never runs.
    if (typeof caches !== "undefined") {
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith("supercheck-"))
              .map((name) => caches.delete(name))
          )
        )
        .catch(() => {});
    }
  }, []);

  return null;
}
