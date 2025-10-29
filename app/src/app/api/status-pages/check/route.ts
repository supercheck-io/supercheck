import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subdomain = searchParams.get("subdomain");

  if (!subdomain) {
    return NextResponse.json(
      { error: "Subdomain parameter is required" },
      { status: 400 }
    );
  }

  try {
    const statusPageResult = await db
      .select({
        id: statusPages.id,
        status: statusPages.status,
      })
      .from(statusPages)
      .where(eq(statusPages.subdomain, subdomain))
      .limit(1);

    if (statusPageResult.length === 0) {
      return NextResponse.json(
        { error: "Status page not found" },
        { status: 404 }
      );
    }

    const { id, status } = statusPageResult[0];

    // Only return data for published status pages
    if (status !== "published") {
      return NextResponse.json(
        { error: "Status page not published" },
        { status: 404 }
      );
    }

    return NextResponse.json({ id, status });
  } catch (error) {
    console.error("Error checking status page subdomain:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
