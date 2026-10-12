"use client";

import Script from "next/script";
import { useEffect, useCallback, useRef } from "react";

/**
 * Chatwoot Widget Settings
 * @see https://www.chatwoot.com/docs/product/channels/live-chat/sdk/setup
 */
export interface ChatwootSettings {
    hideMessageBubble?: boolean;
    position?: "left" | "right";
    locale?: string;
    type?: "standard" | "expanded_bubble";
    darkMode?: "auto" | "light" | "dark";
    showPopoutButton?: boolean;
    launcherTitle?: string;
}

export interface ChatwootWidgetProps {
    websiteToken: string;
    baseUrl: string;
    settings?: ChatwootSettings;
    /** User data for identification - passed from parent component */
    user?: {
        id: string;
        email: string;
        name?: string | null;
        image?: string | null;
        identityValidationToken?: string | null;
    };
    /** Custom attributes for support context */
    customAttributes?: Record<string, string | number | boolean | undefined>;
}

/**
 * Global type declarations for Chatwoot SDK
 */
declare global {
    interface Window {
        chatwootSettings?: ChatwootSettings;
        chatwootSDK?: {
            run: (config: { websiteToken: string; baseUrl: string }) => void;
        };
        $chatwoot?: {
            setUser: (userId: string, userData: Record<string, unknown>) => void;
            setCustomAttributes: (attributes: Record<string, unknown>) => void;
            toggle: (state?: "open" | "close") => void;
            reset: () => void;
            toggleBubbleVisibility?: (state: "show" | "hide") => void;
            hasLoaded?: boolean;
            hideMessageBubble?: boolean;
            resetTriggered?: boolean;
            identifier?: string | number;
            user?: Record<string, unknown>;
        };
    }
}

/**
 * Clears the Chatwoot contact session (call on logout or when the signed-in user changes).
 */
export function resetChatwootSession() {
    const chatwoot = window.$chatwoot;
    if (!chatwoot) return;
    if (chatwoot.hasLoaded) {
        chatwoot.toggle("close");
        chatwoot.toggleBubbleVisibility?.("hide");
    }
    chatwoot.hideMessageBubble = true;
    chatwoot.hasLoaded = false;
    // The SDK retains the old user on reset and suppresses ready; clear both for re-identification.
    delete chatwoot.user;
    delete chatwoot.identifier;
    chatwoot.reset();
    chatwoot.resetTriggered = false;
}

/**
 * Validates and sanitizes the Chatwoot base URL
 * Prevents XSS attacks via malicious URLs
 */
function validateBaseUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        // Allow HTTPS for all hosts
        // Allow HTTP only for localhost development to prevent MITM on remote hosts
        // This implicitly blocks javascript:, data:, and other dangerous protocols
        if (parsed.protocol === "https:") {
            return parsed.origin;
        }
        if (
            parsed.protocol === "http:" &&
            (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
        ) {
            return parsed.origin;
        }
        console.error(
            "[Chatwoot] Invalid protocol/host - only HTTPS allowed, or HTTP for localhost"
        );
        return null;
    } catch {
        console.error("[Chatwoot] Invalid baseUrl format");
        return null;
    }
}

/**
 * Chatwoot Live Chat Widget Component
 *
 * Loads the Chatwoot SDK and initializes the chat widget.
 * This is a low-level component - use SupportChat for the full integration.
 *
 * Security considerations:
 * - Validates baseUrl to prevent XSS
 * - Only passes user data explicitly provided
 * - Does not expose sensitive data
 *
 * @example
 * ```tsx
 * <ChatwootWidget
 *   websiteToken="your-website-token"
 *   baseUrl="https://app.chatwoot.com"
 *   settings={{ position: "right", darkMode: "auto" }}
 *   user={{ id: "123", email: "user@example.com", name: "John" }}
 * />
 * ```
 */
export function ChatwootWidget({
    websiteToken,
    baseUrl,
    settings = {},
    user,
    customAttributes,
}: ChatwootWidgetProps) {
    // Signature of the last identity pushed to Chatwoot, so re-renders never re-send it
    const identifiedSignature = useRef<string | null>(null);
    // Set on unmount so a late SDK load (lazyOnload) can't create a bubble on a page we left
    const unmounted = useRef(false);

    // Validate baseUrl for security
    const validatedBaseUrl = validateBaseUrl(baseUrl);

    // Primitive keys keep the effects below stable when parents pass fresh object literals
    const settingsKey = JSON.stringify(settings);
    const userKey = user
        ? JSON.stringify([
              user.id,
              user.email,
              user.name,
              user.image,
              user.identityValidationToken,
          ])
        : null;
    const attributesKey = customAttributes ? JSON.stringify(customAttributes) : null;

    // Configure Chatwoot settings (must be set before the SDK runs)
    useEffect(() => {
        if (!validatedBaseUrl) return;

        window.chatwootSettings = {
            // Hidden until the user is identified, avoiding a flash of an anonymous bubble
            hideMessageBubble: true,
            position: "right",
            locale: "en",
            type: "standard",
            darkMode: "auto",
            ...(JSON.parse(settingsKey) as ChatwootSettings),
        };
    }, [settingsKey, validatedBaseUrl]);

    // Identify the user once the widget is ready (Chatwoot's `chatwoot:ready` event)
    useEffect(() => {
        if (!validatedBaseUrl || !userKey) return;

        const identify = () => {
            const chatwoot = window.$chatwoot;
            if (!chatwoot) return;

            const signature = `${userKey}|${attributesKey}`;
            if (identifiedSignature.current !== signature) {
                const [id, email, name, image, hash] = JSON.parse(userKey) as [
                    string,
                    string,
                    string | null,
                    string | null,
                    string | null,
                ];
                chatwoot.setUser(id, {
                    email,
                    name: name || email,
                    avatar_url: image || undefined,
                    // Only send the HMAC when identity validation is configured server-side
                    ...(hash ? { identifier_hash: hash } : {}),
                });

                if (attributesKey) {
                    const attributes = Object.fromEntries(
                        Object.entries(
                            JSON.parse(attributesKey) as Record<string, unknown>
                        ).filter(([, v]) => v !== undefined && v !== null)
                    );
                    chatwoot.setCustomAttributes(attributes);
                }
                identifiedSignature.current = signature;
            }
            chatwoot.toggleBubbleVisibility?.("show");
        };

        // The widget may already be ready (e.g. remount after navigation)
        if (window.$chatwoot?.hasLoaded) identify();
        window.addEventListener("chatwoot:ready", identify);
        return () => window.removeEventListener("chatwoot:ready", identify);
    }, [validatedBaseUrl, userKey, attributesKey]);

    // On unmount (logout, public/hidden routes, impersonation) hide the bubble. The contact
    // session itself is cleared by resetChatwootSession() on logout / user switch.
    useEffect(() => {
        unmounted.current = false;
        return () => {
            unmounted.current = true;
            identifiedSignature.current = null;
            const chatwoot = window.$chatwoot;
            if (!chatwoot) return;
            // Bubble DOM is created only once the iframe loads; hiding it earlier throws in the SDK.
            if (chatwoot.hasLoaded) {
                chatwoot.toggle("close");
                chatwoot.toggleBubbleVisibility?.("hide");
            }
            chatwoot.hideMessageBubble = true;
        };
    }, []);

    // Start the SDK once the script has loaded; skip if it is already running
    const handleReady = useCallback(() => {
        if (unmounted.current || !window.chatwootSDK || !validatedBaseUrl || window.$chatwoot) return;

        window.chatwootSDK.run({
            websiteToken,
            baseUrl: validatedBaseUrl,
        });
    }, [websiteToken, validatedBaseUrl]);

    // Don't render if baseUrl is invalid
    if (!validatedBaseUrl) {
        return null;
    }

    return (
        <Script
            id="chatwoot-sdk"
            src={`${validatedBaseUrl}/packs/js/sdk.js`}
            strategy="lazyOnload"
            onReady={handleReady}
        />
    );
}
