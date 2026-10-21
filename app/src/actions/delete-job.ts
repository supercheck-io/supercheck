"use server";

import { requireProjectContext } from "@/lib/project-context";
import { deleteJobWithContext } from "@/lib/resource-deletion/job";

export async function deleteJob(jobId: string) {
  try {
    return await deleteJobWithContext(jobId, await requireProjectContext());
  } catch {
    return { success: false, message: "Failed to delete job", error: "Authentication and project context required" };
  }
}
