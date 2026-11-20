import { NextResponse } from "next/server";
import { getImpersonationStatus } from "@/lib/impersonation-status";

export async function GET() {
  return NextResponse.json(await getImpersonationStatus());
}
