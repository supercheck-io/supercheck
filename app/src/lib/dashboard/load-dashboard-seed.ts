import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getDashboardPayload } from "@/lib/dashboard/get-dashboard-payload";
import { transformDashboardData, type DashboardSeed } from "@/lib/dashboard/dashboard-data";

/**
 * The dashboard data for the signed-in user's current project, read on the server for the page.
 * Same access rule as GET /api/dashboard. Resolves to null instead of throwing, so any failure
 * (signed out, no permission, a query error) leaves the page on its normal client request.
 */
export async function loadDashboardSeed(): Promise<DashboardSeed | null> {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("project", "view", context)) return null;
    const data = transformDashboardData(await getDashboardPayload(context));
    return { projectId: context.project.id, data, updatedAt: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
    // Name and code only: a failed query's message carries its parameters.
    console.error(
      "Dashboard seed failed:",
      (error as { name?: string })?.name ?? "Error",
      (error as { code?: string })?.code ?? "",
    );
    return null;
  }
}
