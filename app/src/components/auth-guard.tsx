"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useSession } from "@/utils/auth-client";

/**
 * AuthGuard - Client-side authentication guard using Better Auth
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Uses Better Auth's useSession hook (properly handles session state)
 * - Does NOT block server rendering (layout stays synchronous)
 * - Prevents layout remounts on navigation
 */

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const router = useRouter();
    const { data: session, isPending } = useSession();

    useEffect(() => {
        // Wait for session check to complete
        if (isPending) return;

        // If no session, go to sign-in
        if (!session) {
            router.replace("/sign-in");
        }
    }, [session, isPending, router]);

    // Show loading while checking session
    if (isPending) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <SuperCheckLoading size="lg" message="Loading, please wait..." />
            </div>
        );
    }

    // No session - will redirect (show loading briefly)
    if (!session) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <SuperCheckLoading size="lg" message="Redirecting..." />
            </div>
        );
    }

    // Session exists - render children
    return <>{children}</>;
}

/**
 * Clear auth session flag (call on sign-out)
 * Note: With useSession, Better Auth handles this automatically
 */
export function clearAuthSession(): void {
    // No-op - Better Auth's signOut handles session clearing
}
