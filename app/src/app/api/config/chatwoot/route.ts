import { NextResponse } from "next/server";
import { isCloudHosted } from "@/lib/feature-flags";
import { z } from "zod";

// Force dynamic rendering - env vars are injected at runtime in K8s
export const dynamic = "force-dynamic";

// URL validation schema - ensures baseUrl is a valid HTTP(S) URL
const chatwootUrlSchema = z.string().url().startsWith("http");

/**
 * Validates Chatwoot base URL format
 * Returns the URL if valid, null otherwise
 */
function validateChatwootUrl(url: string | undefined): string | null {
  if (!url) return null;
  const result = chatwootUrlSchema.safeParse(url);
  if (!result.success) {
    console.warn("[Chatwoot] Invalid baseUrl format:", url);
    return null;
  }
  return result.data;
}

/**
 * GET /api/config/chatwoot
 * Returns the Chatwoot configuration for client-side chat widget
 *
 * This endpoint reads CHATWOOT_* env vars at runtime (not NEXT_PUBLIC_* which are build-time).
 * This pattern matches how CAPTCHA uses TURNSTILE_* vars for server-side reading.
 *
 * The endpoint only returns config in cloud mode (SELF_HOSTED=false) for security.
 * Self-hosted users don't get customer support chat.
 */
export async function GET() {
  // Only enable Chatwoot in cloud mode
  if (!isCloudHosted()) {
    return NextResponse.json({
      enabled: false,
      baseUrl: null,
      websiteToken: null,
    });
  }

  // Read from environment at runtime (server-side only, no NEXT_PUBLIC_ prefix)
  // These are injected via K8s secrets or Docker environment variables
  const rawBaseUrl = process.env.CHATWOOT_BASE_URL;
  const websiteToken = process.env.CHATWOOT_WEBSITE_TOKEN;

  // Validate URL format - fail gracefully with warning if invalid
  const baseUrl = validateChatwootUrl(rawBaseUrl);

  // Both values must be present and valid to enable Chatwoot
  const enabled = !!(baseUrl && websiteToken);

  return NextResponse.json({
    enabled,
    baseUrl: enabled ? baseUrl : null,
    websiteToken: enabled ? websiteToken : null,
  });
}
