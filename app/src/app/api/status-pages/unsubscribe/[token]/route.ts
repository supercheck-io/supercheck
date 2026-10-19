import { NextResponse } from "next/server";
import { unsubscribeFromStatusPage } from "@/actions/unsubscribe-from-status-page";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  // RFC 8058 allows urlencoded or multipart bodies, so parse rather than compare bytes.
  let value: FormDataEntryValue | null = null;
  try {
    value = (await request.formData()).get("List-Unsubscribe");
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof value !== "string" || value.trim() !== "One-Click") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const result = await unsubscribeFromStatusPage(token);
  return NextResponse.json({ success: result.success }, { status: result.success ? 200 : 400 });
}
