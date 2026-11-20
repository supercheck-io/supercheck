import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getDashboardPayload } from "@/lib/dashboard/get-dashboard-payload";
import { transformDashboardData, type DashboardSeed } from "@/lib/dashboard/dashboard-data";
import { withDeadline } from "@/lib/with-deadline";

/** Past this the page stops waiting and the client requests the dashboard itself. */
const SEED_DEADLINE_MS = 5_000;

/**
 * The dashboard data for the signed-in user's current project, read on the server for the page.
 * Same access rule as GET /api/dashboard. Resolves to null instead of throwing, so any failure
 * (signed out, no permission, a query error) leaves the page on its normal client request.
 */
export function loadDashboardSeed(): Promise<DashboardSeed | null> {
  return withDeadline(readDashboardSeed(), SEED_DEADLINE_MS, null);
}

async function readDashboardSeed(): Promise<DashboardSeed | null> {
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("project", "view", context)) return null;
    // Stamped when the read starts: a slow read must not look newer than data fetched while it ran.
    const startedAt = Date.now();
    const data = transformDashboardData(await getDashboardPayload(context));
    return { userId: context.userId, projectId: context.project.id, data, updatedAt: startedAt };
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
