import { NextResponse } from "next/server";

import { getPrivateAgents } from "@/actions/private-agents";

export async function GET() {
  const result = await getPrivateAgents();

  return NextResponse.json(result, { status: result.success ? 200 : 403 });
}
