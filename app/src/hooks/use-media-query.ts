import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches. False on the server and during hydration, so content gated on
 * it mounts only in the browser, and only once the query matches.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
