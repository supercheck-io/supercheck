import { NextResponse } from "next/server";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";

/**
 * GET /api/context
 *
 * Returns the authenticated user's project and organization context.
 * Used by the CLI to resolve org/project slugs for config generation.
 *
 * Supports both CLI token (Bearer) and session cookie authentication.
 */
export async function GET() {
  try {
    const context = await requireAuthContext();

    return NextResponse.json({
      success: true,
      organization: {
        id: context.organizationId,
        name: context.organizationName ?? null,
        slug: context.organizationSlug ?? null,
      },
      project: {
        id: context.project.id,
        name: context.project.name,
        slug: context.project.slug ?? null,
        isDefault: context.project.isDefault,
      },
      user: {
        id: context.userId,
        role: context.project.userRole,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error fetching context:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
