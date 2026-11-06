"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Pending = { href: string } | { back: true } | null;

/**
 * App Router has no route blocker, and `beforeunload` never fires for client navigation. While `active`,
 * this holds back (a) clicks on same-origin links (sidebar, breadcrumbs, any next/link) and (b) browser
 * back/forward, so the caller can ask before leaving. External links, new-tab clicks and downloads are
 * left to the browser (`beforeunload` covers them).
 *
 * Back/forward uses a same-URL sentinel history entry: Back pops the sentinel and stays on the page, so
 * the app never navigates before the user confirms. shortcut: forward from the sentinel is not
 * intercepted, and once the guard turns off (changes saved) the sentinel stays, so one extra Back press
 * returns to the same page.
 */
export function useUnsavedNavigationGuard(active: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const leavingRef = useRef(false);
  const sentinelRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      // Capture phase: runs before next/link's own handler, which must not start the navigation.
      event.preventDefault();
      event.stopPropagation();
      setPending({ href: `${url.pathname}${url.search}${url.hash}` });
    };

    if (!sentinelRef.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      sentinelRef.current = true;
    }
    const onPopState = () => {
      if (leavingRef.current) return;
      // The sentinel was popped: we are on the original entry, same URL, so nothing navigated.
      sentinelRef.current = false;
      setPending({ back: true });
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [active]);

  const stay = useCallback(() => {
    // The dialog also reports "closed" after Leave; that must not re-arm the guard.
    if (!leavingRef.current && pending && "back" in pending && !sentinelRef.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      sentinelRef.current = true;
    }
    setPending(null);
  }, [pending]);

  const leave = useCallback(() => {
    const target = pending;
    setPending(null);
    if (!target) return;
    if ("href" in target) {
      router.push(target.href);
    } else {
      leavingRef.current = true;
      window.history.back();
    }
  }, [pending, router]);

  return { pending: pending !== null, stay, leave };
}
