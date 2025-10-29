import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { apiKey, jobId } = await request.json();

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "API key required",
          message: "API key is required for verification",
        },
        { status: 400 }
      );
    }

    // Basic API key format validation
    if (!apiKey.trim() || apiKey.length < 10) {
      return NextResponse.json(
        {
          error: "Invalid API key format",
          message: "API key must be at least 10 characters long",
        },
        { status: 400 }
      );
    }

    // Verify the API key
    const keyResult = await db
      .select({
        id: apikey.id,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
        jobId: apikey.jobId,
        userId: apikey.userId,
        name: apikey.name,
      })
      .from(apikey)
      .where(eq(apikey.key, apiKey.trim()))
      .limit(1);

    if (keyResult.length === 0) {
      console.warn(`Invalid API key attempted: ${apiKey.substring(0, 8)}...`);
      return NextResponse.json(
        {
          error: "Invalid API key",
          message: "The provided API key is not valid",
        },
        { status: 401 }
      );
    }

    const key = keyResult[0];

    // Check if API key is enabled
    if (!key.enabled) {
      console.warn(`Disabled API key attempted: ${key.name} (${key.id})`);
      return NextResponse.json(
        {
          error: "API key disabled",
          message: "This API key has been disabled",
        },
        { status: 401 }
      );
    }

    // Check if API key has expired
    if (key.expiresAt && new Date() > key.expiresAt) {
      console.warn(`Expired API key attempted: ${key.name} (${key.id})`);
      return NextResponse.json(
        {
          error: "API key expired",
          message: "This API key has expired",
        },
        { status: 401 }
      );
    }

    // If jobId is provided, validate that the API key is authorized for this specific job
    if (jobId && key.jobId !== jobId) {
      console.warn(
        `API key unauthorized for job: ${key.name} attempted job ${jobId}, authorized for ${key.jobId}`
      );
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "This API key is not authorized for the requested job",
        },
        { status: 403 }
      );
    }

    // Update last request timestamp
    await db
      .update(apikey)
      .set({ lastRequest: new Date() })
      .where(eq(apikey.id, key.id));

    // API key is valid
    return NextResponse.json({
      valid: true,
      keyId: key.id,
      jobId: key.jobId,
    });
  } catch (error) {
    console.error("Error verifying API key:", error);

    // Check if this is a database connection error
    const isDbError =
      error instanceof Error &&
      (error.message.includes("connection") ||
        error.message.includes("timeout") ||
        error.message.includes("ECONNREFUSED"));

    return NextResponse.json(
      {
        error: "Authentication error",
        message: isDbError
          ? "Database connection issue. Please try again in a moment."
          : "Unable to verify API key at this time",
      },
      { status: isDbError ? 503 : 500 }
    );
  }
}
