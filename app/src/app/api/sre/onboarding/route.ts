import { NextResponse } from "next/server";

import { getSreOnboardingStatus } from "@/actions/sre-onboarding";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_service", action: "view" },
    { resource: "sre_connector", action: "view" },
  ]);
  if (!auth.success) return auth.response;

  const result = await getSreOnboardingStatus();
  return NextResponse.json(result, { status: result.success ? 200 : 403 });
}
