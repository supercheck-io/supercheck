"use client";

import { Suspense, type ReactNode } from "react";
import { SuperCheckLoading } from "./supercheck-loading";

interface SearchParamsProviderProps {
  children: ReactNode;
  /**
   * Fallback to show while search params are being resolved
   * @default SuperCheckLoading component
   */
  fallback?: ReactNode;
  /**
   * Loading message for the default SuperCheckLoading fallback
   */
  loadingMessage?: string;
}

/**
 * SearchParamsProvider - Wraps components that use useSearchParams() with Suspense
 * 
 * In Next.js App Router, useSearchParams() causes the component to suspend during
 * server-side rendering because search params aren't available until client hydration.
 * This wrapper provides a Suspense boundary with a consistent loading fallback.
 * 
 * @example
 * ```tsx
 * // In a page component:
 * export default function CreatePage() {
 *   return (
 *     <SearchParamsProvider loadingMessage="Loading form...">
 *       <FormWithSearchParams />
 *     </SearchParamsProvider>
 *   );
 * }
 * ```
 * 
 * @see https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
 */
export function SearchParamsProvider({
  children,
  fallback,
  loadingMessage = "Loading...",
}: SearchParamsProviderProps) {
  const defaultFallback = (
    <div className="flex min-h-[400px] items-center justify-center">
      <SuperCheckLoading size="lg" message={loadingMessage} />
    </div>
  );

  return (
    <Suspense fallback={fallback ?? defaultFallback}>
      {children}
    </Suspense>
  );
}

/**
 * MinimalSearchParamsProvider - Minimal Suspense wrapper without loading indicator
 * 
 * Use this when you want the component to render instantly without any loading state
 * flash. The content will simply appear when ready.
 */
export function MinimalSearchParamsProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      {children}
    </Suspense>
  );
}
