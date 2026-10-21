"use server";

import { requireProjectContext } from "@/lib/project-context";
import { deleteMonitorWithContext } from "@/lib/resource-deletion/monitor";

export async function deleteMonitor(monitorId: string) {
  try {
    return await deleteMonitorWithContext(monitorId, await requireProjectContext());
  } catch {
    return { success: false, message: "Failed to delete monitor", error: "Authentication and project context required" };
  }
}
