import { useEffect, useState } from "react";

/**
 * Becomes true once the browser is idle after mount (or after `timeoutMs` at the latest), so work
 * that is not needed for the first paint waits until the page's own requests have gone out.
 */
export function useIdle(timeoutMs = 3000): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setIdle(true), { timeout: timeoutMs });
      return () => window.cancelIdleCallback(handle);
    }
    // No idle callback (Safari): a short delay still lets the page's first requests go out first.
    const timer = setTimeout(() => setIdle(true), Math.min(timeoutMs, 500));
    return () => clearTimeout(timer);
  }, [timeoutMs]);
  return idle;
}
