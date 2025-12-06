import { useState, useRef, useCallback } from "react";
import type { TurnstileCaptchaRef } from "@/components/auth/turnstile-captcha";

/**
 * Hook for managing CAPTCHA state in authentication forms
 *
 * Provides:
 * - Token state management
 * - Error handling callbacks
 * - Reset functionality
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
 * } = useCaptcha();
 *
 * // In form submission
 * await signIn.email({
 *   email,
 *   password,
 *   fetchOptions: {
 *     headers: captchaToken ? { "x-captcha-response": captchaToken } : {},
 *   },
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
    /** Get headers object with CAPTCHA token for fetch options */
    getCaptchaHeaders,
  };
}
