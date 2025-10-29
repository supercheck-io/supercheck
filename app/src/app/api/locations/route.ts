import { NextResponse } from "next/server";
import { getAllLocations } from "@/lib/location-service";

/**
 * GET /api/locations
 * Returns all available monitoring locations with metadata.
 */
export async function GET() {
  try {
    const locations = getAllLocations();

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    console.error("Error fetching locations:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch locations",
      },
      { status: 500 }
    );
  }
}
