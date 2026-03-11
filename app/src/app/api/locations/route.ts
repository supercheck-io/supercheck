import { NextResponse } from "next/server";
import { getEnabledLocations } from "@/lib/location-registry";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "locations-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * GET /api/locations
 * Returns all enabled monitoring locations from the database.
 * Requires authentication.
 */
export async function GET() {
  try {
    await requireAuthContext();

    const locations = await getEnabledLocations();

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error }, "Error fetching locations");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch locations",
      },
      { status: 500 }
    );
  }
}
