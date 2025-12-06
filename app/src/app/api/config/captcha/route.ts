import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/config/captcha
 *
 * Returns CAPTCHA configuration for client-side usage.
 * CAPTCHA is enabled when TURNSTILE_SECRET_KEY environment variable is set.
 *
 * Response:
 * - enabled: boolean - Whether CAPTCHA protection is active
 * - siteKey: string | undefined - Turnstile site key for client widget (only when enabled)
 */
export async function GET() {
  const secretKeySet = !!process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.TURNSTILE_SITE_KEY;

  // CAPTCHA is enabled when secret key is set AND site key is available
  const isEnabled = secretKeySet && !!siteKey;

  return NextResponse.json({
    enabled: isEnabled,
    siteKey: isEnabled ? siteKey : undefined,
  });
}

