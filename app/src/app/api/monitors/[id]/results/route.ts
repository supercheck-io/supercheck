import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorResults } from "@/db/schema";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";
import { requireAuthContext, isAuthError } from '@/lib/auth-context';
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "monitor-results-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};
import { checkPermissionWithContext } from '@/lib/rbac/middleware';
import { isMonitoringLocation } from "@/lib/location-service";
import type { MonitoringLocation } from "@/lib/location-service";

const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

type DateRange = {
  start: Date;
  end: Date;
};

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function parseTimezoneOffset(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < -MAX_TIMEZONE_OFFSET_MINUTES ||
    parsed > MAX_TIMEZONE_OFFSET_MINUTES
  ) {
    return Number.NaN;
  }

  return parsed;
}

export function buildMonitorResultsDateRange(
  dateFilter: string,
  timezoneOffsetMinutes: number | null = null
): DateRange | null {
  if (!DATE_FILTER_PATTERN.test(dateFilter)) {
    return null;
  }

  const [year, month, day] = dateFilter.split("-").map(Number);
  const utcStart = Date.UTC(year, month - 1, day);
  const parsedStart = new Date(utcStart);

  if (
    parsedStart.getUTCFullYear() !== year ||
    parsedStart.getUTCMonth() !== month - 1 ||
    parsedStart.getUTCDate() !== day
  ) {
    return null;
  }

  const offsetMilliseconds =
    (timezoneOffsetMinutes ?? 0) * 60 * 1000;
  const start = new Date(utcStart + offsetMilliseconds);
  const end = new Date(Date.UTC(year, month - 1, day + 1) + offsetMilliseconds);

  return { start, end };
}

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const { id } = params;
  
  if (!id) {
    return NextResponse.json({ error: "Monitor ID is required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const limit = parsePositiveInteger(searchParams.get('limit'), 10);
  const dateFilter = searchParams.get('date'); // YYYY-MM-DD format
  const timezoneOffset = parseTimezoneOffset(searchParams.get("timezoneOffset"));
  const locationParam = searchParams.get("location"); // Optional location filter
  const locationFilter: MonitoringLocation | null = isMonitoringLocation(
    locationParam
  )
    ? (locationParam as MonitoringLocation)
    : null;

  // Validate pagination parameters
  if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || limit < 1 || limit > 100) {
    return NextResponse.json({
      error: "Invalid pagination parameters. Page must be >= 1, limit must be 1-100"
    }, { status: 400 });
  }

  if (Number.isNaN(timezoneOffset)) {
    return NextResponse.json({
      error: "Invalid timezoneOffset parameter. Must be an integer between -840 and 840 minutes"
    }, { status: 400 });
  }

  const dateRange = dateFilter
    ? buildMonitorResultsDateRange(dateFilter, timezoneOffset)
    : null;

  if (dateFilter && !dateRange) {
    return NextResponse.json({
      error: "Invalid date parameter. Expected YYYY-MM-DD"
    }, { status: 400 });
  }

  try {
    const authContext = await requireAuthContext();
    
    // First, find the monitor to check permissions
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    if (monitor.organizationId !== authContext.organizationId || monitor.projectId !== authContext.project.id) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    const canView = checkPermissionWithContext("monitor", "view", authContext);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view this monitor" },
        { status: 403 }
      );
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Build where condition with optional date and location filters
    const conditions = [eq(monitorResults.monitorId, id)];

    if (dateRange) {
      conditions.push(
        gte(monitorResults.checkedAt, dateRange.start),
        lt(monitorResults.checkedAt, dateRange.end)
      );
    }

    if (locationFilter) {
      conditions.push(eq(monitorResults.location, locationFilter));
    }

    const whereCondition = conditions.length > 1 ? and(...conditions) : conditions[0];

    // Run count and results queries in parallel for better performance
    const [countResult, results] = await Promise.all([
      // Get total count for pagination metadata
      db
        .select({ count: sql<number>`count(*)` })
        .from(monitorResults)
        .where(whereCondition),

      // Get the specific page of results
      db
        .select()
        .from(monitorResults)
        .where(whereCondition)
        .orderBy(desc(monitorResults.checkedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count || 0);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error, monitorId: id }, "Error fetching paginated monitor results");
    return NextResponse.json({ error: "Failed to fetch monitor results" }, { status: 500 });
  }
}
