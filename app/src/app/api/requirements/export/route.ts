import { NextResponse } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { exportRequirementsCsvRecord, toServiceContext } from "@/lib/requirements/service";

export async function GET() {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("requirement", "view", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { csv } = await exportRequirementsCsvRecord(toServiceContext(context));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="requirements.csv"',
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error exporting requirements:", error);
    return NextResponse.json({ error: "Failed to export requirements" }, { status: 500 });
  }
}
