import { NextResponse } from "next/server";
import { getImpersonationStatus } from "@/lib/impersonation-status";

export async function GET() {
  const status = await getImpersonationStatus();
  // A failed lookup is not an answer: 503 so clients that must fail closed (the support chat) keep waiting.
  if (!status) return NextResponse.json({ error: "Impersonation status unavailable" }, { status: 503 });
  return NextResponse.json(status);
}
