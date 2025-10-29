import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const error = searchParams.get("error") || "Unknown error";
  const message = searchParams.get("message") || "An error occurred";

  return NextResponse.json({ error, message }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const error = searchParams.get("error") || "Unknown error";
  const message = searchParams.get("message") || "An error occurred";

  return NextResponse.json({ error, message }, { status: 401 });
}
