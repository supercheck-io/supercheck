"use client";

import { useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/utils/auth-client";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

/**
 * AuthGuard - Client-side authentication guard using Better Auth
 *
 * SECURITY & PERFORMANCE:
 * - Uses Better Auth's useSession hook (properly handles session state)
 * - Does NOT render protected content until authentication is confirmed
 * - Shows loading state while checking authentication
 * - Prevents layout remounts on navigation once authenticated
 * 
 * PERFORMANCE OPTIMIZATION (Server-Side Hydration):
 * - Accepts optional `initialSession` prop from server-side rendering
 * - When provided, renders children immediately without waiting for useSession
 * - useSession still runs in background to revalidate and keep session fresh
 * - This eliminates the "checking authentication" spinner on initial load
 * 
 * SECURITY: Session Expiry Handling
 * - If server provided a session but useSession completes with null,
 *   the session has expired between server render and client hydration
 * - In this case, we redirect to sign-in (security over UX)
 * */

interface InitialSession {
    user: {
        id: string;
        name: string;
        email: string;
        image?: string | null;
    };
}

interface AuthGuardProps {
    children: React.ReactNode;
    /** 
     * Optional server-side pre-fetched session. When provided, AuthGuard
     * renders children immediately, trusting the server-validated session.
     * The useSession hook still runs to revalidate in background.
     */
    initialSession?: InitialSession | null;
}

export function AuthGuard({ children, initialSession }: AuthGuardProps) {
    const router = useRouter();
    const { data: session, isPending } = useSession();
    // Use ref to track redirect to avoid re-renders and lint warnings
    const isRedirectingRef = useRef(false);

    // SECURITY: Determine effective session state
    // Priority: 1) useSession result (when available), 2) initialSession (during pending)
    // This ensures that if useSession completes with null, we don't trust initialSession
    const effectiveSession = useMemo(() => isPending
        ? (initialSession ? { user: initialSession.user } : null)  // Use server data while pending
        : session, [isPending, initialSession, session]);  // Once useSession completes, trust its result (even if null)

    // Only show loading if we're pending AND don't have an initial session from server
    const isEffectivelyPending = isPending && !initialSession;

    // SECURITY: Detect session expiry (server had session, but client says no)
    const sessionExpired = !isPending && !session && !!initialSession;

    useEffect(() => {
        // Wait for session check to complete (if we don't have initial session)
        if (isEffectivelyPending) return;

        // SECURITY: If session expired or no session exists, redirect to sign-in
        if ((sessionExpired || !effectiveSession) && !isRedirectingRef.current) {
            isRedirectingRef.current = true;
            router.replace("/sign-in");
        }
    }, [effectiveSession, isEffectivelyPending, sessionExpired, router]);

    // Show loading while checking session - DO NOT render protected content
    // But skip this if we have a server-provided initialSession
    if (isEffectivelyPending) {
        return (
            <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
                <SuperCheckLoading size="lg" message="Checking authentication..." />
            </div>
        );
    }

    // SECURITY: No session or session expired - show loading while redirecting
    // DO NOT render protected content under any circumstance
    if (!effectiveSession || sessionExpired) {
        return (
            <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
                <SuperCheckLoading size="lg" message="Redirecting to sign in..." />
            </div>
        );
    }

    // Session exists and is valid - render protected children
    return <>{children}</>;
}

/**
 * Clear auth session flag (call on sign-out)
 * Note: With useSession, Better Auth handles this automatically
 */
export function clearAuthSession(): void {
    // No-op - Better Auth's signOut handles session clearing
}
