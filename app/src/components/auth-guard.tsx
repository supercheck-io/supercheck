"use client";

import { useEffect, useRef } from "react";
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
 */

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const router = useRouter();
    const { data: session, isPending } = useSession();
    // Use ref to track redirect to avoid re-renders and lint warnings
    const isRedirectingRef = useRef(false);

    useEffect(() => {
        // Wait for session check to complete
        if (isPending) return;

        // If no session, go to sign-in (use ref to prevent duplicate redirects)
        if (!session && !isRedirectingRef.current) {
            isRedirectingRef.current = true;
            router.replace("/sign-in");
        }
    }, [session, isPending, router]);

    // Show loading while checking session - DO NOT render protected content
    if (isPending) {
        return (
            <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
                <SuperCheckLoading size="lg" message="Please wait, loading..." />
            </div>
        );
    }

    // No session - show loading while redirecting, DO NOT render protected content
    if (!session) {
        return (
            <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
                <SuperCheckLoading size="lg" message="Redirecting to sign in..." />
            </div>
        );
    }

    // Session exists - render protected children
    return <>{children}</>;
}

/**
 * Clear auth session flag (call on sign-out)
 * Note: With useSession, Better Auth handles this automatically
 */
export function clearAuthSession(): void {
    // No-op - Better Auth's signOut handles session clearing
}
