import { NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionData = await auth.api.getSession({
    headers: await headers(),
  });

  if (!sessionData?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const userId = sessionData.user.id;

  const key = process.env.CHATWOOT_IDENTITY_VALIDATION_KEY;

  if (!key) {
    // If no key is configured, return null/empty. 
    // This allows the widget to work without verification if the feature is disabled in Chatwoot settings.
    return NextResponse.json({ token: null });
  }

  // Generate HMAC SHA256 signature of the user ID using the validation key
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(userId);
  const token = hmac.digest("hex");

  return NextResponse.json({ token });
}
