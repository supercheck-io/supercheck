import { NextRequest, NextResponse } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { isUuid } from "@/lib/uuid";
import {
  getRequirementDto,
  linkTestsRecord,
  listLinkedTestsRecord,
  restTestIdsSchema,
  toServiceContext,
  unlinkTestsRecord,
  type RequirementServiceContext,
} from "@/lib/requirements/service";

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json({ error: "Requirement not found" }, { status: 404 });

const authFailure = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Authentication required" },
    { status: 401 }
  );

async function readJson(request: NextRequest): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function respondWithRequirement(
  ctx: RequirementServiceContext,
  id: string,
  result: { success: boolean; error?: string; code?: string }
) {
  if (!result.success) {
    if (result.code === "not_found") {
      return NextResponse.json(
        { error: result.error ?? "Requirement or tests not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: result.error ?? "Request failed" }, { status: 400 });
  }
  const requirement = await getRequirementDto(ctx, id);
  if (!requirement) return notFound();
  return NextResponse.json({ requirement });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "view", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const linked = await listLinkedTestsRecord(toServiceContext(context), id);
    if (!linked) return notFound();
    return NextResponse.json({ tests: linked });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error fetching linked tests:", error);
    return NextResponse.json({ error: "Failed to fetch linked tests" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to link tests" },
        { status: 403 }
      );
    }
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const parsed = restTestIdsSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const ctx = toServiceContext(context);
    const result = await linkTestsRecord(ctx, id, Array.from(new Set(parsed.data.testIds)));
    return respondWithRequirement(ctx, id, result);
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error linking tests:", error);
    return NextResponse.json({ error: "Failed to link tests" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to unlink tests" },
        { status: 403 }
      );
    }
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const queryTestId = new URL(request.url).searchParams.get("testId");
    const candidate = queryTestId ? { testIds: [queryTestId] } : await readJson(request);
    const parsed = restTestIdsSchema.safeParse(candidate);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const ctx = toServiceContext(context);
    const result = await unlinkTestsRecord(ctx, id, Array.from(new Set(parsed.data.testIds)));
    return respondWithRequirement(ctx, id, result);
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error unlinking tests:", error);
    return NextResponse.json({ error: "Failed to unlink tests" }, { status: 500 });
  }
}
