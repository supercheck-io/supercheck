"use server";

import * as service from "@/lib/server-actions/update-job";
export type { UpdateJobData } from "@/lib/server-actions/update-job";
import type { UpdateJobData } from "@/lib/server-actions/update-job";

export async function updateJob(data: UpdateJobData) {
  return service.updateJob(data);
}
