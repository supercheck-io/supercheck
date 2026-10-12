"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/utils/auth-client";
import { useImpersonationStatus } from "@/hooks/use-impersonation-status";
import { ChatwootWidget, resetChatwootSession } from "./chatwoot-widget";

// Routes where the chat widget should be hidden (external/public pages)
const HIDDEN_ROUTES = [
    "/notification-", // notification-monitor, notification-run
    "/status/",       // public status pages
    "/sign-in",       // auth pages
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/onboarding",    // onboarding flow
];

interface ChatwootConfigResponse {
    enabled: boolean;
    baseUrl: string | null;
    websiteToken: string | null;
}

// Hydration-safe mounting detection using useSyncExternalStore (React 18+ best practice)
// This avoids calling setState in useEffect which triggers cascading renders
const emptySubscribe = () => () => { };
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Custom hook for hydration-safe mounting detection
 * Uses useSyncExternalStore to avoid setState in useEffect
 */
function useHydrated() {
    return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}

/**
 * Support Chat Component
 *
 * Smart wrapper for the Chatwoot widget that:
 * 1. Only renders for cloud users (disabled when SELF_HOSTED=true)
 * 2. Identifies the user to Chatwoot with relevant context
 * 3. Passes user and organization information to support agents
 * 4. Disables chat during admin impersonation (security)
 *
 * Security considerations:
 * - Uses server-side API to check SELF_HOSTED env var (runtime, not build-time)
 * - Only enabled in cloud mode (not for self-hosted)
 * - Only passes non-sensitive user data (id, email, name)
 * - No cross-tenant data leakage (each user sees only their chat)
 * - DISABLED during impersonation to prevent:
 *   - Admin accidentally chatting as the impersonated user
 *   - Chat history cross-contamination
 *   - Confusion for support agents about who they're talking to
 *
 * @example
 * ```tsx
 * // In layout.tsx, inside AuthGuard
 * <SupportChat />
 * ```
 */
export function SupportChat() {
    const { data: session } = useSession();
    const { isImpersonating, isLoading: isImpersonationLoading } = useImpersonationStatus();
    const isHydrated = useHydrated();
    const pathname = usePathname();
    const [chatwootConfig, setChatwootConfig] = useState<ChatwootConfigResponse | null>(null);
    // Identity token is per user: store it with the id it was issued for
    const [identity, setIdentity] = useState<{ userId: string; token: string | null } | null>(null);
    const userId = session?.user?.id ?? null;
    const previousUserId = useRef<string | null>(null);

    // Check if current route is an external/public page
    const isExternalPage = HIDDEN_ROUTES.some(route => pathname?.startsWith(route));

    // Fetch Chatwoot config from server (runtime values from K8s secrets)
    // This replaces the build-time NEXT_PUBLIC_* env vars which don't work in K8s
    useEffect(() => {
        if (!isHydrated) return;

        const fetchConfig = async () => {
            try {
                const configResponse = await fetch("/api/config/chatwoot");
                if (!configResponse.ok) {
                    setChatwootConfig({ enabled: false, baseUrl: null, websiteToken: null });
                    return;
                }
                setChatwootConfig(await configResponse.json());
            } catch {
                // Default to disabling chat on error (fail-safe)
                setChatwootConfig({ enabled: false, baseUrl: null, websiteToken: null });
            }
        };

        fetchConfig();
    }, [isHydrated]);

    // Fetch the identity-validation HMAC for the current user (re-run when the user changes)
    const chatEnabled = !!chatwootConfig?.enabled;
    useEffect(() => {
        if (!chatEnabled || !userId || isExternalPage) return;

        let cancelled = false;
        const fetchToken = async () => {
            let token: string | null = null;
            try {
                const tokenResponse = await fetch("/api/auth/chatwoot-token");
                if (tokenResponse.ok) {
                    token = (await tokenResponse.json()).token ?? null;
                }
            } catch (e) {
                // Identity validation is optional - chat still works without it
                console.warn("[Chatwoot] Failed to fetch identity token:", e);
            }
            if (!cancelled) setIdentity({ userId, token });
        };

        fetchToken();
        return () => {
            cancelled = true;
        };
    }, [chatEnabled, userId, isExternalPage]);

    // Clear the Chatwoot contact session on logout or when a different user signs in
    useEffect(() => {
        if (previousUserId.current && previousUserId.current !== userId) {
            resetChatwootSession();
        }
        previousUserId.current = userId;
    }, [userId]);

    // Don't render if:
    // 1. Not hydrated yet (avoid hydration mismatch)
    // 2. On an external/public page (notification, status)
    // 3. Still loading config
    // 4. Chat not enabled (self-hosted or missing config)
    // 5. No authenticated user
    // 6. Still loading impersonation status (wait for it)
    // 7. Admin is impersonating a user (SECURITY: prevent cross-contamination)
    if (
        !isHydrated ||
        isExternalPage ||
        chatwootConfig === null ||
        !chatwootConfig.enabled ||
        !chatwootConfig.baseUrl ||
        !chatwootConfig.websiteToken ||
        identity?.userId !== userId ||
        !session?.user ||
        isImpersonationLoading ||
        isImpersonating
    ) {
        return null;
    }

    const user = session.user;

    // Build custom attributes for support context
    // Include organization ID for support debugging
    const customAttributes = {
        supercheck_user_id: user.id,
        organization_id: session.session?.activeOrganizationId || "unknown",
        source: "supercheck-app",
        app_version: process.env.NEXT_PUBLIC_SUPERCHECK_VERSION || "unknown",
    };

    return (
        <ChatwootWidget
            websiteToken={chatwootConfig.websiteToken}
            baseUrl={chatwootConfig.baseUrl}
            settings={{
                position: "right",
                darkMode: "auto",
                type: "standard",
                showPopoutButton: false, // Hide "open in new window" button
            }}
            user={{
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                identityValidationToken: identity.token,
            }}
            customAttributes={customAttributes}
        />
    );
}
