import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { OrganizationManagementError, switchOrganization } from "@/lib/services/organization-management";

const schema = z.object({ organizationId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid organization ID is required" }, { status: 400 });
  try {
    const data = await switchOrganization(parsed.data.organizationId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof OrganizationManagementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to switch organization:", error);
    return NextResponse.json({ error: "Failed to switch organization" }, { status: 500 });
  }
}
