import { useState, useRef, useCallback } from "react";
import type { TurnstileCaptchaRef } from "@/components/auth/turnstile-captcha";

/**
 * Hook for managing CAPTCHA state in authentication forms
 *
 * Provides:
 * - Token state management
 * - Error handling callbacks
 * - Reset functionality
 * - On-demand token execution via `executeCaptcha()`
 * - Ref for the Turnstile component
 *
 * @example
 * ```tsx
 * const {
 *   captchaToken,
 *   captchaError,
 *   captchaRef,
 *   handleCaptchaSuccess,
 *   handleCaptchaError,
 *   handleCaptchaExpire,
 *   resetCaptcha,
 *   executeCaptcha,
 * } = useCaptcha();
 *
 * // Get a fresh token before each form submission
 * const token = await executeCaptcha();
 * const headers = token ? { "x-captcha-response": token } : {};
 *
 * await signIn.email({
 *   email,
 *   password,
 *   fetchOptions: { headers },
 * });
 * ```
 */
export function useCaptcha() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileCaptchaRef>(null);

  const handleCaptchaSuccess = useCallback((token: string) => {
    setCaptchaToken(token);
    setCaptchaError(null);
  }, []);

  const handleCaptchaError = useCallback(() => {
    setCaptchaError("CAPTCHA verification failed. Please try again.");
    setCaptchaToken(null);
  }, []);

  const handleCaptchaExpire = useCallback(() => {
    setCaptchaError("CAPTCHA expired. Please verify again.");
    setCaptchaToken(null);
  }, []);

  const resetCaptcha = useCallback(() => {
    captchaRef.current?.reset();
    setCaptchaToken(null);
    setCaptchaError(null);
  }, []);

  /**
   * Execute the CAPTCHA challenge and return a fresh, unused token.
   * 
   * This is the preferred way to get tokens before form submissions.
   * Each call resets the widget and obtains a new single-use token,
   * avoiding the token-reuse bug that occurs when the same token is
   * sent to multiple endpoints (e.g. signUp then signIn).
   * 
   * Returns null if CAPTCHA is disabled (e.g. self-hosted mode).
   */
  const executeCaptcha = useCallback(async (): Promise<string | null> => {
    if (!captchaRef.current) return null;
    const token = await captchaRef.current.execute();
    if (token) {
      setCaptchaToken(token);
      setCaptchaError(null);
    }
    return token;
  }, []);

  /**
   * Get fetch options headers with CAPTCHA token if available
   * Use this when making auth API calls
   */
  const getCaptchaHeaders = useCallback((): Record<string, string> => {
    return captchaToken ? { "x-captcha-response": captchaToken } : {};
  }, [captchaToken]);

  return {
    /** Current CAPTCHA token (null if not verified) */
    captchaToken,
    /** Current CAPTCHA error message (null if no error) */
    captchaError,
    /** Ref to pass to TurnstileCaptcha component */
    captchaRef,
    /** Handler for successful CAPTCHA completion */
    handleCaptchaSuccess,
    /** Handler for CAPTCHA verification failure */
    handleCaptchaError,
    /** Handler for CAPTCHA token expiration */
    handleCaptchaExpire,
    /** Reset CAPTCHA state and widget */
    resetCaptcha,
    /**
     * Execute CAPTCHA and get a fresh single-use token.
     * Returns null if CAPTCHA is disabled. Always use this
     * before each auth API call to avoid token-reuse issues.
     */
    executeCaptcha,
    /** Get headers object with CAPTCHA token for fetch options */
    getCaptchaHeaders,
  };
}
