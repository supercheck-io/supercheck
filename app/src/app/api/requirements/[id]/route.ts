import { NextRequest, NextResponse } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { isUuid } from "@/lib/uuid";
import {
  deleteRequirementRecord,
  getRequirementDto,
  restUpdateRequirementSchema,
  toServiceContext,
  updateRequirementWithRelations,
} from "@/lib/requirements/service";

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json({ error: "Requirement not found" }, { status: 404 });

const authFailure = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Authentication required" },
    { status: 401 }
  );

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "view", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const requirement = await getRequirementDto(toServiceContext(context), id);
    if (!requirement) return notFound();
    return NextResponse.json({ requirement });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error fetching requirement:", error);
    return NextResponse.json({ error: "Failed to fetch requirement" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to update requirements" },
        { status: 403 }
      );
    }

    const { id } = await params;
    if (!isUuid(id)) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = restUpdateRequirementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const serviceCtx = toServiceContext(context);
    const result = await updateRequirementWithRelations(serviceCtx, id, parsed.data);
    if (!result.success) {
      if (result.code === "not_found") return notFound();
      return NextResponse.json(
        { error: result.error ?? "Failed to update requirement" },
        { status: 400 }
      );
    }

    const requirement = await getRequirementDto(serviceCtx, id);
    if (!requirement) return notFound();
    return NextResponse.json({ requirement });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error updating requirement:", error);
    return NextResponse.json({ error: "Failed to update requirement" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "delete", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete requirements" },
        { status: 403 }
      );
    }

    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const result = await deleteRequirementRecord(toServiceContext(context), id);
    if (!result.success) {
      if (result.code === "not_found") return notFound();
      return NextResponse.json(
        { error: result.error ?? "Failed to delete requirement" },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error deleting requirement:", error);
    return NextResponse.json({ error: "Failed to delete requirement" }, { status: 500 });
  }
}
