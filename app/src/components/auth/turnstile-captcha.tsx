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
    /** Reset the CAPTCHA widget */
    reset: () => void;
    /** Get the current CAPTCHA token (null if not verified) */
    getToken: () => string | null;
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
 * Only renders when CAPTCHA is enabled (TURNSTILE_SECRET_KEY is set).
 *
 * Features:
 * - Invisible mode for seamless UX
 * - Auto-detects dark/light theme
 * - Fetches config from /api/config/captcha
 * - Exposes reset/getToken methods via ref
 *
 * @example
 * ```tsx
 * const captchaRef = useRef<TurnstileCaptchaRef>(null);
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

    // Expose reset and getToken methods via ref
    useImperativeHandle(ref, () => ({
        reset: () => {
            turnstileRef.current?.reset();
            setToken(null);
        },
        getToken: () => token,
    }));

    const handleSuccess = (newToken: string) => {
        setToken(newToken);
        onSuccess(newToken);
    };

    const handleError = () => {
        setToken(null);
        onError?.();
    };

    const handleExpire = () => {
        setToken(null);
        onExpire?.();
    };

    // Don't render if config not loaded, disabled, or no site key
    if (!config || !config.enabled || !config.siteKey) {
        return null;
    }

    return (
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
            className={className}
        />
    );
});
