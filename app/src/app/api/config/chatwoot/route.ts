import { NextResponse } from "next/server";
import { isCloudHosted } from "@/lib/feature-flags";

// Force dynamic rendering - env vars are injected at runtime in K8s
export const dynamic = "force-dynamic";

/**
 * GET /api/config/chatwoot
 * Returns the Chatwoot configuration for client-side chat widget
 * 
 * This endpoint is needed because NEXT_PUBLIC_* env vars are baked in at build time,
 * but in Kubernetes deployments, these values are injected at runtime via secrets.
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

  // Read from environment (available at runtime in K8s via secrets)
  const baseUrl = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
  const websiteToken = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;

  // Both values must be present to enable Chatwoot
  const enabled = !!(baseUrl && websiteToken);

  return NextResponse.json({
    enabled,
    baseUrl: enabled ? baseUrl : null,
    websiteToken: enabled ? websiteToken : null,
  });
}
