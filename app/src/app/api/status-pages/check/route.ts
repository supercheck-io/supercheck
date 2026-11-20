import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const checkSchema = z.object({
  subdomain: z.string().min(1, "Subdomain is required").trim(),
});

async function checkSubdomainAvailability(subdomain: string) {
  const statusPageResult = await db
    .select({
      id: statusPages.id,
      status: statusPages.status,
    })
    .from(statusPages)
    .where(eq(statusPages.subdomain, subdomain))
    .limit(1);

  // A draft answers exactly like a missing page so callers cannot discover unpublished subdomains.
  const page = statusPageResult[0];
  if (!page || page.status !== "published") {
    return NextResponse.json({ error: "Status page not found" }, { status: 404 });
  }

  return NextResponse.json({ id: page.id, status: page.status });
}

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
    return await checkSubdomainAvailability(subdomain);
  } catch (error) {
    console.error("Error checking status page subdomain:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const validation = checkSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0]?.message || "Invalid request" },
        { status: 400 }
      );
    }

    return await checkSubdomainAvailability(validation.data.subdomain);
  } catch (error) {
    console.error("Error checking status page subdomain:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
