"use server";

import * as service from "@/lib/server-actions/sre-onboarding";
export type { SreOnboardingStatus } from "@/lib/server-actions/sre-onboarding";

export async function getSreOnboardingStatus() {
  return service.getSreOnboardingStatus();
}
