import { NextResponse } from "next/server";
import { isCloudHosted } from "@/lib/feature-flags";

// Force dynamic rendering - SELF_HOSTED is set at runtime in K8s/Docker
export const dynamic = "force-dynamic";

/**
 * GET /api/config/hosting-mode
 * Returns the hosting mode (self-hosted vs cloud) for client-side checks
 * 
 * This endpoint is needed because NEXT_PUBLIC_* env vars are baked in at build time,
 * but SELF_HOSTED is set at runtime in Docker deployments.
 */
export async function GET() {
  const cloudHosted = isCloudHosted();
  
  return NextResponse.json({
    selfHosted: !cloudHosted,
    cloudHosted: cloudHosted,
  });
}
