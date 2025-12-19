"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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

    // Show loading while checking session - render children to preserve sidebar layout
    // The page-level loading.tsx files handle showing appropriate loading skeletons
    if (isPending) {
        return <>{children}</>;
    }

    // No session - will redirect (show loading briefly)
    // Still render children to preserve layout during redirect
    if (!session) {
        return <>{children}</>;
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
