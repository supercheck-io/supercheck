"use client";

import { useEffect, useMemo } from "react";

const FAVICON_STATE_KEY = "__supercheckFaviconState";
const FAVICON_RELS = ["icon", "shortcut icon", "apple-touch-icon"] as const;

type FaviconState = {
  icons: Map<
    string,
    {
      element: HTMLLinkElement;
      originalHref: string | null;
      originalType: string | null;
      created: boolean;
    }
  >;
  refCount: number;
  currentHref: string;
  restoreTimeoutId: number | null;
};

type ExtendedWindow = Window & {
  [FAVICON_STATE_KEY]?: FaviconState;
};

/**
 * Keeps the custom status page favicon active while any public view is mounted.
 * Restores the original app favicon once the last public view unmounts.
 */
export function useStatusPageFavicon(faviconLogo?: string | null) {
  const cacheBustedHref = useMemo(() => {
    if (!faviconLogo) {
      return null;
    }

    // Use multiple cache-busting techniques:
    // 1. Current timestamp for uniqueness
    // 2. Random component to prevent aggressive caching
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const cacheBuster = `v=${timestamp}-${random}`;
    const separator = faviconLogo.includes("?") ? "&" : "?";
    return `${faviconLogo}${separator}${cacheBuster}`;
  }, [faviconLogo]);

  useEffect(() => {
    if (!cacheBustedHref || typeof window === "undefined") {
      return;
    }

    const safeRemove = (icon: HTMLLinkElement | null | undefined) => {
      if (!icon) return;
      if (typeof icon.remove === "function") {
        try {
          icon.remove();
          return;
        } catch {
          // fall through to parent removal
        }
      }
      if (icon.parentNode) {
        try {
          icon.parentNode.removeChild(icon);
        } catch {
          // ignore
        }
      }
    };

    const win = window as ExtendedWindow;
    if (!win[FAVICON_STATE_KEY]) {
      win[FAVICON_STATE_KEY] = {
        icons: new Map(),
        refCount: 0,
        currentHref: "",
        restoreTimeoutId: null,
      };
    }

    const state = win[FAVICON_STATE_KEY]!;

    if (state.restoreTimeoutId !== null) {
      window.clearTimeout(state.restoreTimeoutId);
      state.restoreTimeoutId = null;
    }

    state.refCount += 1;

    const ensureIcon = (rel: (typeof FAVICON_RELS)[number]) => {
      const existing = state.icons.get(rel);
      if (existing) {
        return existing.element;
      }

      let element =
        document.head.querySelector<HTMLLinkElement>(`link[rel='${rel}']`) ??
        null;
      const created = !element;

      if (!element) {
        element = document.createElement("link");
        element.rel = rel;
        document.head.appendChild(element);
      }

      const originalHref = element.getAttribute("href");
      const originalType = element.getAttribute("type");

      element.type = "image/png";
      state.icons.set(rel, { element, originalHref, originalType, created });

      return element;
    };

    const applyFavicon = () => {
      FAVICON_RELS.forEach((rel) => {
        const icon = ensureIcon(rel);
        icon.href = cacheBustedHref;
      });

      state.currentHref = cacheBustedHref;
    };

    if (state.refCount === 1 || state.currentHref !== cacheBustedHref) {
      applyFavicon();
    }

    return () => {
      state.refCount = Math.max(state.refCount - 1, 0);

      if (state.refCount === 0) {
        state.restoreTimeoutId = window.setTimeout(() => {
          if (state.refCount > 0) {
            return;
          }

          state.icons.forEach(
            ({ element, originalHref, originalType, created }) => {
              if (created) {
                safeRemove(element);
              } else if (originalHref) {
                element.href = originalHref;
              } else {
                element.removeAttribute("href");
              }

              if (originalType) {
                element.type = originalType;
              } else {
                element.removeAttribute("type");
              }
            }
          );

          state.icons.clear();
          state.currentHref = "";
          state.restoreTimeoutId = null;
        }, 0);
      }
    };
  }, [cacheBustedHref]);
}
