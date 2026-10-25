import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import {
  deleteComponent,
  httpStatusForServiceError,
  toComponentDto,
  updateComponent,
  updateComponentFieldsSchema,
} from "@/lib/status-pages/service";

const idsSchema = z.object({
  id: z.string().uuid("Invalid status page ID format"),
  componentId: z.string().uuid("Invalid component ID format"),
});

type RouteContext = { params: Promise<{ id: string; componentId: string }> };

const updateBodySchema = updateComponentFieldsSchema.strict();

/** PUT /api/status-pages/[id]/components/[componentId] - updates a component. */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const ids = idsSchema.safeParse(await context.params);
    if (!ids.success) {
      return NextResponse.json(
        { error: ids.error.issues[0]?.message || "Invalid ID format" },
        { status: 400 }
      );
    }

    const authCtx = await requireAuthContext();
    if (!checkPermissionWithContext("status_page", "update", authCtx)) {
      return NextResponse.json(
        { error: "Insufficient permissions to update components" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request body" },
        { status: 400 }
      );
    }

    const result = await updateComponent(
      {
        userId: authCtx.userId,
        organizationId: authCtx.organizationId,
        projectId: authCtx.project.id,
        projectName: authCtx.project.name,
      },
      ids.data.id,
      ids.data.componentId,
      parsed.data
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: httpStatusForServiceError(result.code) }
      );
    }

    return NextResponse.json({
      component: toComponentDto(result.data.component, result.data.monitorIds),
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error updating component:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** DELETE /api/status-pages/[id]/components/[componentId] - deletes a component. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const ids = idsSchema.safeParse(await context.params);
    if (!ids.success) {
      return NextResponse.json(
        { error: ids.error.issues[0]?.message || "Invalid ID format" },
        { status: 400 }
      );
    }

    const authCtx = await requireAuthContext();
    // Mirrors the dashboard action, which requires the delete permission.
    if (!checkPermissionWithContext("status_page", "delete", authCtx)) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete components" },
        { status: 403 }
      );
    }

    const result = await deleteComponent(
      {
        userId: authCtx.userId,
        organizationId: authCtx.organizationId,
        projectId: authCtx.project.id,
        projectName: authCtx.project.name,
      },
      ids.data.id,
      ids.data.componentId
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: httpStatusForServiceError(result.code) }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting component:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
