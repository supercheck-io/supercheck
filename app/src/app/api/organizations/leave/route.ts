import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, isAuthError } from "@/lib/auth-context";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { leaveOrganization, LeaveOrganizationError } from "@/lib/services/leave-organization";

const schema = z.object({ organizationId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid organization ID is required" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await leaveOrganization(parsed.data.organizationId) });
  } catch (error) {
    if (error instanceof LeaveOrganizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required" }, { status: authErrorStatus(error) });
    }
    console.error("Failed to leave organization:", error);
    return NextResponse.json({ error: "Failed to leave organization" }, { status: 500 });
  }
}
