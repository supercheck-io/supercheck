import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isUuid } from "@/lib/uuid";
import { requireAdmin } from "@/lib/admin";
import { adminDeniedResponse } from "@/lib/admin-errors";
import { getCurrentUser } from "@/lib/session";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { checkAdminRateLimit } from "@/lib/session-security";
import { purgeOrganizationNow } from "@/lib/deletion/organization";

const bodySchema = z.object({ reason: z.string().trim().min(10).max(500), confirmOrganizationId: z.string().uuid() });

/**
 * POST /api/admin/organizations/[id]/purge
 * Super admin only (legal erasure): skip the grace window and purge now. Audited with the mandatory reason.
 * Body: { reason, confirmOrganizationId }. Customers cannot do this.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireAdmin();
    const admin = await getCurrentUser();
    if (!admin) throw new Error("Authentication required");
    if (await isImpersonatedSession()) return NextResponse.json({ success: false, error: "Stop impersonating before purging organizations" }, { status: 403 });
    if (!isUuid(id)) return NextResponse.json({ success: false, error: "Organization not found" }, { status: 404 });
    const limit = await checkAdminRateLimit(admin.id, "purge_organization", 10, 10 * 60 * 1000);
    if (!limit.allowed) return NextResponse.json({ success: false, error: "Too many purges. Try again later." }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || parsed.data.confirmOrganizationId !== id) {
      return NextResponse.json({ success: false, error: "A reason (at least 10 characters) and confirmOrganizationId are required" }, { status: 400 });
    }
    const result = await purgeOrganizationNow({ organizationId: id, adminUserId: admin.id, reason: parsed.data.reason });
    if (!result) return NextResponse.json({ success: false, error: "Organization not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: { deletionId: result.deletionId, wasPending: result.wasPending } });
  } catch (error) {
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error("Admin organization purge error:", error);
    return NextResponse.json({ success: false, error: "Failed to purge organization" }, { status: 500 });
  }
}
