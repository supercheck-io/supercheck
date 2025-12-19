/**
 * Monaco Editor Prefetcher
 *
 * PERFORMANCE OPTIMIZATION:
 * Preloads Monaco editor assets in the background after user authentication.
 * Uses requestIdleCallback to ensure non-blocking preload that doesn't
 * impact page responsiveness.
 *
 * Assets preloaded:
 * - Monaco editor React component (~2MB)
 * - TypeScript type definitions (supercheck.d.ts ~62KB)
 *
 * This eliminates the 1-3 second delay when navigating to the playground
 * for the first time by warming up the cache in advance.
 */

"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/utils/auth-client";

// ============================================================================
// MODULE-LEVEL STATE (survives component re-renders)
// ============================================================================

/** Flag to prevent duplicate Monaco library preload requests */
let monacoPreloadStarted = false;

/** Flag to prevent duplicate type definitions preload requests */
let typesPreloadStarted = false;

/** Cached type definitions content for instant access */
let cachedTypeDefs: string | null = null;

/** Flag indicating type definitions are fully loaded */
let typeDefsLoaded = false;

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Polyfill for requestIdleCallback
 * Falls back to setTimeout for browsers that don't support it
 */
function scheduleIdleTask(
    callback: () => void,
    options?: { timeout?: number }
): void {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as Window & { requestIdleCallback: typeof requestIdleCallback }).requestIdleCallback(
            callback,
            options
        );
    } else {
        // Fallback: use setTimeout with a delay to avoid blocking
        setTimeout(callback, options?.timeout ?? 1000);
    }
}

/**
 * Preload Monaco editor library
 * Uses loader.init() which:
 * 1. Loads Monaco from CDN
 * 2. Loads Monaco CSS (prevents unstyled flash)
 * 3. Caches the monaco instance for instant access
 */
async function preloadMonacoLibrary(): Promise<void> {
    try {
        // Import the loader (small ~2KB)
        const { loader } = await import("@monaco-editor/react");

        // Initialize Monaco - this loads the full Monaco library + CSS
        // Once initialized, subsequent Editor components mount instantly
        await loader.init();
    } catch (error) {
        // Silently fail - preload is best-effort
        console.debug("[MonacoPrefetcher] Monaco library preload failed:", error);
    }
}

/**
 * Preload TypeScript type definitions
 * Fetches and caches the supercheck.d.ts file
 */
async function preloadTypeDefinitions(): Promise<void> {
    try {
        const response = await fetch("/supercheck.d.ts", {
            // Use cache-first strategy
            cache: "default",
            // Low priority - don't compete with critical resources
            priority: "low",
        } as RequestInit);

        if (response.ok) {
            cachedTypeDefs = await response.text();
            typeDefsLoaded = true;
        }
    } catch (error) {
        // Silently fail - preload is best-effort
        console.debug("[MonacoPrefetcher] Type definitions preload failed:", error);
    }
}

// ============================================================================
// EXPORTED UTILITIES
// ============================================================================

/**
 * Get cached type definitions if available
 *
 * @returns Cached type definitions content, or null if not yet loaded
 *
 * @example
 * ```typescript
 * const cached = getCachedTypeDefs();
 * if (cached) {
 *   // Use cached content instead of fetching
 *   monaco.languages.typescript.javascriptDefaults.addExtraLib(cached, uri);
 * } else {
 *   // Fall back to fetching
 *   const response = await fetch("/supercheck.d.ts");
 *   // ...
 * }
 * ```
 */
export function getCachedTypeDefs(): string | null {
    return cachedTypeDefs;
}

/**
 * Check if type definitions have been fully loaded
 *
 * @returns True if type definitions are cached and ready
 */
export function areTypeDefsLoaded(): boolean {
    return typeDefsLoaded;
}

/**
 * Manually trigger Monaco preload
 *
 * Useful for hover-intent prefetching when user hovers over
 * a link that leads to the playground.
 *
 * @example
 * ```typescript
 * const handleMouseEnter = () => {
 *   // Start preloading Monaco when user hovers over playground link
 *   triggerMonacoPreload();
 * };
 * ```
 */
export function triggerMonacoPreload(): void {
    if (!monacoPreloadStarted) {
        monacoPreloadStarted = true;
        scheduleIdleTask(() => {
            void preloadMonacoLibrary();
        }, { timeout: 1000 });
    }

    if (!typesPreloadStarted) {
        typesPreloadStarted = true;
        scheduleIdleTask(() => {
            void preloadTypeDefinitions();
        }, { timeout: 2000 });
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * MonacoPrefetcher Component
 *
 * Renders nothing - this is a "headless" component that exists purely
 * for its side effects (background preloading).
 *
 * Place this high in the component tree (e.g., in the main layout)
 * so it mounts early and has time to preload before user navigates
 * to the playground.
 *
 * @example
 * ```tsx
 * // In app/(main)/layout.tsx
 * <AuthGuard>
 *   <DataPrefetcher />
 *   <MonacoPrefetcher />
 *   {children}
 * </AuthGuard>
 * ```
 */
export function MonacoPrefetcher(): null {
    const { data: session } = useSession();
    const hasTriggeredRef = useRef(false);

    useEffect(() => {
        // Only preload for authenticated users
        if (!session) return;

        // Only trigger once per session
        if (hasTriggeredRef.current) return;
        hasTriggeredRef.current = true;

        // Wait a bit after initial render to avoid competing with
        // critical page resources
        const delayMs = 2000;

        const timer = setTimeout(() => {
            triggerMonacoPreload();
        }, delayMs);

        return () => {
            clearTimeout(timer);
        };
    }, [session]);

    // This component renders nothing
    return null;
}
