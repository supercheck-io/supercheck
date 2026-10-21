"use server";

import { requireProjectContext } from "@/lib/project-context";
import { deleteRunWithContext } from "@/lib/resource-deletion/run";

export async function deleteRun(runId: string) {
  try {
    return await deleteRunWithContext(runId, await requireProjectContext());
  } catch {
    return { success: false, message: "Failed to delete run", error: "Authentication and project context required" };
  }
}
