"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const STORE_KEY = "shell-main-scroll-v1";

// Module state outlives a remount (moving between the app and super admin shells) and is shared by both.
let positions: Record<string, number> | undefined;
// The pathname a back/forward (or a reload) is returning to; consumed by the next render of that pathname.
let restorePath: string | null = null;
let documentChecked = false;

function load(): Record<string, number> {
  if (!positions) {
    try {
      positions = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || "{}") as Record<string, number>;
    } catch {
      positions = {};
    }
  }
  return positions;
}

function save() {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(positions ?? {}));
  } catch {
    /* storage can be blocked: restoring is a convenience */
  }
}

/**
 * The desktop shell's scroller. Because <main> (not the window) scrolls, it also has to do what the browser
 * does for the window: start a new page at the top, restore the position on back/forward and reload, and take
 * keyboard focus so Space, PageDown, Home and End scroll it without a click first.
 * Positions are kept per pathname (a query-only change such as a tab keeps one position).
 */
export function ShellMain({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const currentPath = useRef<string | null>(null);

  useEffect(() => {
    if (!documentChecked) {
      documentChecked = true;
      const nav = window.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type === "back_forward" || nav?.type === "reload") restorePath = window.location.pathname;
    }
    const onPop = () => {
      restorePath = window.location.pathname;
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  // Before paint and before any clamping scroll event, so a scroll is never saved under the previous page.
  useLayoutEffect(() => {
    const main = ref.current;
    if (!main) return;
    currentPath.current = pathname;
    const target = restorePath === pathname ? load()[pathname] ?? 0 : 0;
    restorePath = null;
    // shortcut: gives up after ~0.5 s, so content that loads later than that is not restored; raise if it matters.
    let frames = 0;
    let frame = 0;
    const apply = () => {
      main.scrollTop = target;
      if (target > 0 && main.scrollTop < target && frames++ < 30) frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    // Take focus only when nothing else has it (never from an input, dialog or the command search).
    if (!document.activeElement || document.activeElement === document.body) ref.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <main
      ref={ref}
      tabIndex={-1}
      className={`outline-none ${className ?? ""}`}
      onScroll={(event) => {
        if (currentPath.current) load()[currentPath.current] = event.currentTarget.scrollTop;
      }}
    >
      {children}
    </main>
  );
}
