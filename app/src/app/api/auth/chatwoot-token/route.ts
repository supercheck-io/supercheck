import { NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/auth/chatwoot-token
 * Returns the HMAC-SHA256 identifier hash Chatwoot uses to verify the signed-in user
 * (https://www.chatwoot.com/hc/user-guide/articles/1677587232-how-to-set-up-identity-validation).
 */
export async function GET() {
  const sessionData = await auth.api.getSession({
    headers: await headers(),
  });

  if (!sessionData?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Never mint an identity hash for an impersonated user: the admin's browser would keep
  // a non-expiring credential for the victim's Chatwoot contact.
  if (sessionData.session?.impersonatedBy) {
    return NextResponse.json({ token: null }, { headers: NO_STORE });
  }

  const userId = sessionData.user.id;

  const key = process.env.CHATWOOT_IDENTITY_VALIDATION_KEY;

  if (!key) {
    // If no key is configured, return null/empty. 
    // This allows the widget to work without verification if the feature is disabled in Chatwoot settings.
    return NextResponse.json({ token: null }, { headers: NO_STORE });
  }

  // Generate HMAC SHA256 signature of the user ID using the validation key
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(userId);
  const token = hmac.digest("hex");

  return NextResponse.json({ token }, { headers: NO_STORE });
}
