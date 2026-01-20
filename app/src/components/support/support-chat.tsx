"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSession } from "@/utils/auth-client";
import { useImpersonationStatus } from "@/hooks/use-impersonation-status";
import { ChatwootWidget } from "./chatwoot-widget";

interface HostingModeResponse {
    selfHosted: boolean;
    cloudHosted: boolean;
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
    const [isCloudMode, setIsCloudMode] = useState<boolean | null>(null);
    const [identityToken, setIdentityToken] = useState<string | null>(null);

    // Check config - these are set at build time
    const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
    const token = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;
    const hasChatwootConfig = !!baseUrl && !!token;

    // Fetch config after hydration (only if Chatwoot is configured)
    useEffect(() => {
        if (!isHydrated || !hasChatwootConfig) return;

        const fetchConfig = async () => {
            try {
                // Check hosting mode from server (SELF_HOSTED is a runtime env var)
                const hostingResponse = await fetch("/api/config/hosting-mode");
                if (!hostingResponse.ok) {
                    setIsCloudMode(false);
                    return;
                }
                const hostingData: HostingModeResponse = await hostingResponse.json();

                // Only enable chat if we're in cloud mode
                if (!hostingData.cloudHosted) {
                    setIsCloudMode(false);
                    return;
                }

                setIsCloudMode(true);

                // Fetch identity token for verified user badge
                try {
                    const tokenResponse = await fetch("/api/auth/chatwoot-token");
                    if (tokenResponse.ok) {
                        const tokenData = await tokenResponse.json();
                        setIdentityToken(tokenData.token);
                    }
                } catch (e) {
                    // Identity validation is optional - chat still works without it
                    console.warn("[Chatwoot] Failed to fetch identity token:", e);
                }
            } catch {
                // Default to disabling chat on error (fail-safe)
                setIsCloudMode(false);
            }
        };

        fetchConfig();
    }, [isHydrated, hasChatwootConfig]);

    // Don't render if:
    // 1. Not mounted yet (avoid hydration mismatch)
    // 2. Still determining hosting mode
    // 3. Not in cloud mode (self-hosted users don't get chat)
    // 4. Configuration is missing
    // 5. No authenticated user
    // 6. Still loading impersonation status (wait for it)
    // 7. Admin is impersonating a user (SECURITY: prevent cross-contamination)
    if (
        !isHydrated ||
        isCloudMode === null ||
        !isCloudMode ||
        !hasChatwootConfig ||
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
        app_version: process.env.NEXT_PUBLIC_APP_VERSION || "unknown",
    };

    return (
        <ChatwootWidget
            websiteToken={token}
            baseUrl={baseUrl}
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
                identityValidationToken: identityToken,
            }}
            customAttributes={customAttributes}
        />
    );
}
