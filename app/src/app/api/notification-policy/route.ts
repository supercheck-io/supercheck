import { NextRequest, NextResponse } from "next/server";

import { authErrorStatus, isAuthError, requireAuthContext } from "@/lib/auth-context";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getNotificationPolicy, saveNotificationPolicy } from "@/lib/sre/notification-policy";

const MAX_BODY_BYTES = 8_192;

/** The current project's incident policy (CLI and API callers; the UI uses the server action). */
export async function GET() {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("project", "view", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const { autoInvestigateEnabledAt, ...policy } = await getNotificationPolicy(context.project.id);
    return NextResponse.json({ policy: { ...policy, autoInvestigateEnabledAt: autoInvestigateEnabledAt?.toISOString() ?? null } });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: (error as Error).message }, { status: authErrorStatus(error) });
    return NextResponse.json({ error: "Failed to load the notification policy" }, { status: 500 });
  }
}

/** Replaces the current project's incident policy. Same validation as the settings dialog. */
export async function PUT(req: NextRequest) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("project", "update", context)) {
      return await permissionDeniedResponse(context.organizationId, "Insufficient permissions to update the notification policy");
    }
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const result = await saveNotificationPolicy(
      { organizationId: context.organizationId, projectId: context.project.id, userId: context.userId },
      body,
    );
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    return GET();
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: (error as Error).message }, { status: authErrorStatus(error) });
    return NextResponse.json({ error: "Failed to save the notification policy" }, { status: 500 });
  }
}
