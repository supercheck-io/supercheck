import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import {
  createComponent,
  createComponentFieldsSchema,
  httpStatusForServiceError,
  listComponents,
  toComponentDto,
} from "@/lib/status-pages/service";

const uuidSchema = z.string().uuid("Invalid status page ID format");

type RouteContext = { params: Promise<{ id: string }> };

// Public REST contract: name, description, monitorIds, position (plus the
// optional component settings the dashboard also exposes).
const createBodySchema = createComponentFieldsSchema.strict();

/** GET /api/status-pages/[id]/components - components ordered by position. */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid status page ID format" }, { status: 400 });
    }

    const authCtx = await requireAuthContext();
    if (!checkPermissionWithContext("status_page", "view", authCtx)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const result = await listComponents(
      {
        userId: authCtx.userId,
        organizationId: authCtx.organizationId,
        projectId: authCtx.project.id,
        projectName: authCtx.project.name,
      },
      id
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: httpStatusForServiceError(result.code) }
      );
    }
    return NextResponse.json({ components: result.data.components });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error listing components:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** POST /api/status-pages/[id]/components - creates a component. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid status page ID format" }, { status: 400 });
    }

    const authCtx = await requireAuthContext();
    if (!checkPermissionWithContext("status_page", "update", authCtx)) {
      return NextResponse.json(
        { error: "Insufficient permissions to create components" },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request body" },
        { status: 400 }
      );
    }

    // Pass the raw body so "status was not provided" is detected like the dashboard action does.
    const result = await createComponent(
      {
        userId: authCtx.userId,
        organizationId: authCtx.organizationId,
        projectId: authCtx.project.id,
        projectName: authCtx.project.name,
      },
      id,
      body as z.input<typeof createComponentFieldsSchema>
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: httpStatusForServiceError(result.code) }
      );
    }

    return NextResponse.json(
      { component: toComponentDto(result.data.component, result.data.monitorIds) },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error creating component:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
