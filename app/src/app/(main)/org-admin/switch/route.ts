import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/uuid";
import { switchOrganization } from "@/lib/services/organization-management";

/**
 * Re-authentication drops the active organization, so the deletion dialog sends the owner back through here: it makes the
 * organization active again (membership is checked by switchOrganization) and lands on the organization page.
 * Never switches on a cross-site navigation.
 */
export async function GET(request: NextRequest) {
  const target = new URL("/org-admin", request.url);
  const organizationId = request.nextUrl.searchParams.get("org");
  if (request.headers.get("sec-fetch-site") === "cross-site" || !organizationId || !isUuid(organizationId)) return NextResponse.redirect(target);
  try {
    await switchOrganization(organizationId);
  } catch {
    // Not a member or not signed in: the organization page decides what to show.
  }
  return NextResponse.redirect(target);
}
