import { NextResponse } from "next/server";

import { getSreServices } from "@/actions/sre-services";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_service", action: "view" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  const result = await getSreServices();

  if (!result.success) {
    return NextResponse.json(result, { status: 403 });
  }

  return NextResponse.json(result);
}
