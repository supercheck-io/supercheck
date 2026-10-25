"use client";

import { useEffect } from "react";

/**
 * HydrationReady - flags the document once the client tree has hydrated.
 *
 * End-to-end tests navigate with `waitUntil: "load"`, which can fire before
 * React attaches event handlers. Clicks dispatched in that window are
 * swallowed, so the E2E suite waits for `html[data-hydrated="true"]` (see
 * `app/e2e/utils/hydration.ts`) before interacting with a freshly loaded page.
 *
 * This component renders nothing.
 */
export function HydrationReady() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return null;
}
