import { NextResponse } from "next/server";
import { unsubscribeFromStatusPage } from "@/actions/unsubscribe-from-status-page";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const body = await request.text();
  if (body !== "List-Unsubscribe=One-Click") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result = await unsubscribeFromStatusPage(token);
  return NextResponse.json({ success: result.success }, { status: result.success ? 200 : 400 });
}
