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
            isLoaded?: boolean;
        };
    }
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
    const isIdentified = useRef(false);

    // Validate baseUrl for security
    const validatedBaseUrl = validateBaseUrl(baseUrl);

    // Configure Chatwoot settings on mount
    useEffect(() => {
        if (!validatedBaseUrl) return;

        window.chatwootSettings = {
            hideMessageBubble: false,
            position: "right",
            locale: "en",
            type: "standard",
            darkMode: "auto",
            ...settings,
        };
    }, [settings, validatedBaseUrl]);

    // Handle SDK load - identify user after SDK is ready
    const handleLoad = useCallback(() => {
        if (!window.chatwootSDK || !validatedBaseUrl) return;

        window.chatwootSDK.run({
            websiteToken,
            baseUrl: validatedBaseUrl,
        });

        // Identify user after SDK initialization (with small delay for SDK to be ready)
        if (user && !isIdentified.current) {
            setTimeout(() => {
                if (window.$chatwoot) {
                    window.$chatwoot.setUser(user.id, {
                        email: user.email,
                        name: user.name || user.email,
                        avatar_url: user.image || undefined,
                        identifier_hash: user.identityValidationToken, // Pass the HMAC token
                    });

                    if (customAttributes) {
                        // Filter out undefined values
                        const filteredAttributes = Object.fromEntries(
                            Object.entries(customAttributes).filter(([, v]) => v !== undefined)
                        );
                        window.$chatwoot.setCustomAttributes(filteredAttributes);
                    }

                    isIdentified.current = true;
                }
            }, 500);
        }
    }, [websiteToken, validatedBaseUrl, user, customAttributes]);

    // Re-identify user if user data changes after initial load
    useEffect(() => {
        if (!user || !window.$chatwoot || !isIdentified.current) return;

        window.$chatwoot.setUser(user.id, {
            email: user.email,
            name: user.name || user.email,
            avatar_url: user.image || undefined,
        });

        if (customAttributes) {
            const filteredAttributes = Object.fromEntries(
                Object.entries(customAttributes).filter(([, v]) => v !== undefined)
            );
            window.$chatwoot.setCustomAttributes(filteredAttributes);
        }
    }, [user, customAttributes]);

    // Don't render if baseUrl is invalid
    if (!validatedBaseUrl) {
        return null;
    }

    return (
        <Script
            id="chatwoot-sdk"
            src={`${validatedBaseUrl}/packs/js/sdk.js`}
            strategy="lazyOnload"
            onLoad={handleLoad}
        />
    );
}
