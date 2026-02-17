"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import {
    forwardRef,
    useImperativeHandle,
    useRef,
    useState,
    useEffect,
} from "react";
import { z } from "zod";

interface TurnstileCaptchaProps {
    /** Callback when CAPTCHA is successfully completed */
    onSuccess: (token: string) => void;
    /** Callback when CAPTCHA verification fails */
    onError?: () => void;
    /** Callback when CAPTCHA token expires */
    onExpire?: () => void;
    /** Additional CSS classes */
    className?: string;
}

export interface TurnstileCaptchaRef {
    /** Reset the CAPTCHA widget and clear the current token */
    reset: () => void;
    /** Get the current CAPTCHA token (null if not verified) */
    getToken: () => string | null;
    /**
     * Execute the CAPTCHA challenge and return a fresh token.
     * Use this before form submission to ensure a valid, unused token.
     * Returns null if CAPTCHA is not enabled or the challenge fails.
     */
    execute: () => Promise<string | null>;
}

// Zod schema for runtime validation of CAPTCHA config API response
const captchaConfigSchema = z.object({
    enabled: z.boolean(),
    siteKey: z.string().optional(),
});

type CaptchaConfig = z.infer<typeof captchaConfigSchema>;

/**
 * Cloudflare Turnstile CAPTCHA Component
 *
 * Renders an invisible Turnstile widget that automatically verifies users.
 * Only renders when CAPTCHA is enabled (cloud mode with Turnstile keys configured).
 * Never renders in self-hosted mode.
 *
 * Features:
 * - Invisible mode for seamless UX
 * - Auto-detects dark/light theme
 * - Fetches config from /api/config/captcha
 * - Exposes reset/getToken/execute methods via ref
 * - execute() returns a Promise for on-demand fresh tokens
 * - No layout shift: uses absolute positioning when invisible
 *
 * @example
 * ```tsx
 * const captchaRef = useRef<TurnstileCaptchaRef>(null);
 *
 * // Get a fresh token before submission
 * const token = await captchaRef.current?.execute();
 *
 * <TurnstileCaptcha
 *   ref={captchaRef}
 *   onSuccess={(token) => setCaptchaToken(token)}
 *   onError={() => setError("CAPTCHA failed")}
 * />
 * ```
 */
export const TurnstileCaptcha = forwardRef<
    TurnstileCaptchaRef,
    TurnstileCaptchaProps
>(function TurnstileCaptcha(
    { onSuccess, onError, onExpire, className },
    ref
) {
    const turnstileRef = useRef<TurnstileInstance>(null);
    const [config, setConfig] = useState<CaptchaConfig | null>(null);
    const [token, setToken] = useState<string | null>(null);
    // Promise resolver for execute() — allows await-ing a fresh token
    const executeResolverRef = useRef<((token: string | null) => void) | null>(null);
    const executeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Resolve the pending execute() promise (if any) and clear the timeout.
     * Centralises cleanup to avoid repeating the same logic in every handler.
     */
    const resolveExecute = (value: string | null) => {
        if (executeResolverRef.current) {
            executeResolverRef.current(value);
            executeResolverRef.current = null;
        }
        if (executeTimeoutRef.current) {
            clearTimeout(executeTimeoutRef.current);
            executeTimeoutRef.current = null;
        }
    };

    // Fetch CAPTCHA configuration on mount
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const response = await fetch("/api/config/captcha");
                if (!response.ok) {
                    console.warn("[CAPTCHA] Failed to fetch config:", response.status);
                    setConfig({ enabled: false });
                    return;
                }
                const data = await response.json();
                // Validate response shape at runtime
                const parsed = captchaConfigSchema.safeParse(data);
                if (!parsed.success) {
                    console.warn("[CAPTCHA] Invalid config response:", parsed.error.message);
                    setConfig({ enabled: false });
                    return;
                }
                setConfig(parsed.data);
            } catch (error) {
                // Fail-safe: disable CAPTCHA on network errors
                console.warn("[CAPTCHA] Config fetch error:", error instanceof Error ? error.message : "Unknown error");
                setConfig({ enabled: false });
            }
        };

        fetchConfig();
    }, []);

    // Clean up pending execute() promise and timeout on unmount
    useEffect(() => {
        return () => {
            resolveExecute(null);
        };
    }, []);

    // Expose reset, getToken, and execute methods via ref
    useImperativeHandle(ref, () => ({
        reset: () => {
            turnstileRef.current?.reset();
            setToken(null);
        },
        getToken: () => token,
        execute: () => {
            // If CAPTCHA is not enabled, resolve immediately with null (no token needed)
            if (!config || !config.enabled || !config.siteKey) {
                return Promise.resolve(null);
            }
            // Resolve any pending execute() to avoid leaving callers hanging
            resolveExecute(null);
            // Reset the widget to get a fresh token
            turnstileRef.current?.reset();
            setToken(null);
            // Return a promise that resolves when onSuccess fires with the new token
            return new Promise<string | null>((resolve) => {
                // Store the resolver; handleSuccess will call it
                executeResolverRef.current = resolve;
                // Set a timeout to prevent hanging if the challenge never completes
                executeTimeoutRef.current = setTimeout(() => {
                    if (executeResolverRef.current === resolve) {
                        executeResolverRef.current = null;
                        resolve(null);
                    }
                    executeTimeoutRef.current = null;
                }, 30000); // 30 second timeout
            });
        },
    }), [token, config]);

    const handleSuccess = (newToken: string) => {
        setToken(newToken);
        onSuccess(newToken);
        resolveExecute(newToken);
    };

    const handleError = () => {
        setToken(null);
        onError?.();
        resolveExecute(null);
    };

    const handleExpire = () => {
        setToken(null);
        onExpire?.();
        resolveExecute(null);
    };

    // Don't render if config not loaded, disabled, or no site key
    if (!config || !config.enabled || !config.siteKey) {
        return null;
    }

    return (
        <div
            className={className}
            // Invisible Turnstile renders a 0-height iframe; use sr-only positioning
            // to prevent any layout shift while keeping the widget accessible
            style={{ position: "absolute", left: "-9999px", top: "-9999px", width: 0, height: 0, overflow: "hidden" }}
            aria-hidden="true"
        >
            <Turnstile
                ref={turnstileRef}
                siteKey={config.siteKey}
                onSuccess={handleSuccess}
                onError={handleError}
                onExpire={handleExpire}
                options={{
                    // Use invisible mode for seamless UX
                    size: "invisible",
                    // Auto-detect theme based on user preference
                    theme: "auto",
                }}
            />
        </div>
    );
});
