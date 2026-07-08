import { NextResponse } from "next/server";

import { getPrivateAgents } from "@/actions/private-agents";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_connector", action: "view" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  const result = await getPrivateAgents();

  return NextResponse.json(result, { status: result.success ? 200 : 403 });
}
