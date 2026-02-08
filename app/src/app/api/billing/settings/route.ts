import { NextResponse } from "next/server";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { auditBillingSettingsChange } from "@/lib/audit-log";
import { z } from "zod";

/**
 * GET /api/billing/settings
 * Get billing settings for the active organization
 */
export async function GET() {
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Only org admins/owners can view billing settings
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const settings = await billingSettingsService.getSettings(organizationId);

    return NextResponse.json(settings);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching billing settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing settings" },
      { status: 500 }
    );
  }
}

// Validation schema for billing settings update
const updateSettingsSchema = z.object({
  monthlySpendingLimitDollars: z.number().min(0).nullable().optional(),
  enableSpendingLimit: z.boolean().optional(),
  hardStopOnLimit: z.boolean().optional(),
  notifyAt50Percent: z.boolean().optional(),
  notifyAt80Percent: z.boolean().optional(),
  notifyAt90Percent: z.boolean().optional(),
  notifyAt100Percent: z.boolean().optional(),
  notificationEmails: z.array(z.string().email()).optional(),
});

/**
 * PATCH /api/billing/settings
 * Update billing settings for the active organization
 */
export async function PATCH(request: Request) {
  try {
    const { userId, organizationId } = await requireUserAuthContext();

    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    // Only org admins/owners can modify billing settings
    const orgRole = await getUserOrgRole(userId, organizationId);
    const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
    if (!isOrgAdmin) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = updateSettingsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: validation.error.errors },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Get current settings for audit logging
    const previousSettings = await billingSettingsService.getSettings(organizationId);

    // Convert dollars to cents if provided
    const updates: Parameters<typeof billingSettingsService.updateSettings>[1] = {};

    if (data.monthlySpendingLimitDollars !== undefined) {
      updates.monthlySpendingLimitCents = data.monthlySpendingLimitDollars !== null
        ? Math.round(data.monthlySpendingLimitDollars * 100)
        : null;
    }

    if (data.enableSpendingLimit !== undefined) {
      updates.enableSpendingLimit = data.enableSpendingLimit;
    }

    if (data.hardStopOnLimit !== undefined) {
      updates.hardStopOnLimit = data.hardStopOnLimit;
    }

    if (data.notifyAt50Percent !== undefined) {
      updates.notifyAt50Percent = data.notifyAt50Percent;
    }

    if (data.notifyAt80Percent !== undefined) {
      updates.notifyAt80Percent = data.notifyAt80Percent;
    }

    if (data.notifyAt90Percent !== undefined) {
      updates.notifyAt90Percent = data.notifyAt90Percent;
    }

    if (data.notifyAt100Percent !== undefined) {
      updates.notifyAt100Percent = data.notifyAt100Percent;
    }

    if (data.notificationEmails !== undefined) {
      updates.notificationEmails = data.notificationEmails;
    }

    const settings = await billingSettingsService.updateSettings(organizationId, updates);

    // Audit log the billing settings change (non-blocking)
    auditBillingSettingsChange(
      organizationId,
      userId,
      previousSettings as unknown as Record<string, unknown>,
      settings as unknown as Record<string, unknown>,
    ).catch((err) => console.error("[Audit] Failed to log billing settings change:", err));

    return NextResponse.json(settings);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error updating billing settings:", error);
    return NextResponse.json(
      { error: "Failed to update billing settings" },
      { status: 500 }
    );
  }
}
