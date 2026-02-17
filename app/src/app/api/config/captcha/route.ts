import { NextResponse } from "next/server";
import { isCaptchaEnabled, getTurnstileSiteKey } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * GET /api/config/captcha
 *
 * Returns CAPTCHA configuration for client-side usage.
 * CAPTCHA is enabled only in cloud mode when both TURNSTILE_SECRET_KEY
 * and TURNSTILE_SITE_KEY environment variables are set.
 * Self-hosted deployments always return { enabled: false }.
 *
 * Response:
 * - enabled: boolean - Whether CAPTCHA protection is active
 * - siteKey: string | undefined - Turnstile site key for client widget (only when enabled)
 */
export async function GET() {
  const isEnabled = isCaptchaEnabled();
  const siteKey = isEnabled ? getTurnstileSiteKey() : undefined;

  return NextResponse.json({
    enabled: isEnabled,
    siteKey: siteKey ?? undefined,
  });
}

