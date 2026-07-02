import { NextResponse } from "next/server";

import { getSreServices } from "@/actions/sre-services";

export async function GET() {
  const result = await getSreServices();

  if (!result.success) {
    return NextResponse.json(result, { status: 403 });
  }

  return NextResponse.json(result);
}
