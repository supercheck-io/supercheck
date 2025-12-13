/**
 * Session Invalidation API Endpoint
 * 
 * Allows authenticated users to invalidate all their sessions except the current one.
 * Useful for security actions like password changes or suspected account compromise.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { db } from "@/utils/db";
import { session } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "invalidate-sessions" });

/**
 * POST /api/auth/invalidate-sessions
 * 
 * Invalidates all user sessions except the current one.
 * 
 * Request body (optional):
 * - invalidateAll: boolean - If true, also invalidates the current session (logout everywhere)
 * 
 * Returns:
 * - 200: Sessions invalidated successfully
 * - 401: Not authenticated
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Get current session
    const authSession = await auth.api.getSession({
      headers: await headers(),
    });

    if (!authSession) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = authSession.user.id;
    const currentSessionToken = authSession.session.token;

    // Parse request body for options
    let invalidateAll = false;
    try {
      const body = await request.json();
      invalidateAll = body?.invalidateAll === true;
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Count sessions before invalidation
    const sessionCountBefore = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    
    const totalSessions = sessionCountBefore.length;

    let invalidatedCount = 0;

    if (invalidateAll) {
      // Invalidate ALL sessions including current
      await db
        .update(session)
        .set({ expiresAt: new Date(0) }) // Set to epoch to immediately expire
        .where(eq(session.userId, userId));
      
      invalidatedCount = totalSessions;
    } else {
      // Invalidate all sessions EXCEPT current
      await db
        .update(session)
        .set({ expiresAt: new Date(0) })
        .where(
          and(
            eq(session.userId, userId),
            ne(session.token, currentSessionToken)
          )
        );
      
      invalidatedCount = Math.max(0, totalSessions - 1);
    }

    // Log the security action
    await logAuditEvent({
      userId,
      action: "sessions_invalidated",
      resource: "session",
      metadata: {
        invalidatedCount,
        totalSessions,
        invalidateAll,
        ip: request.headers.get("x-forwarded-for") || 
            request.headers.get("x-real-ip") || 
            "unknown",
        userAgent: request.headers.get("user-agent"),
      },
      success: true,
    });

    logger.info(
      { userId: userId.substring(0, 8), invalidatedCount, invalidateAll },
      "User sessions invalidated"
    );

    return NextResponse.json({
      success: true,
      message: invalidateAll 
        ? `All ${invalidatedCount} sessions have been invalidated`
        : `${invalidatedCount} other session(s) have been invalidated`,
      data: {
        invalidatedCount,
        totalSessions,
        currentSessionPreserved: !invalidateAll,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to invalidate sessions");
    
    return NextResponse.json(
      { 
        error: "Failed to invalidate sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/invalidate-sessions
 * 
 * Returns information about the user's active sessions.
 */
export async function GET() {
  try {
    const authSession = await auth.api.getSession({
      headers: await headers(),
    });

    if (!authSession) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = authSession.user.id;
    const currentSessionToken = authSession.session.token;

    // Get all active sessions for the user
    const activeSessions = await db
      .select({
        id: session.id,
        token: session.token,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, userId));

    // Filter to only show non-expired sessions
    const now = new Date();
    const validSessions = activeSessions.filter(
      (s) => s.expiresAt > now
    );

    return NextResponse.json({
      success: true,
      data: {
        totalSessions: validSessions.length,
        sessions: validSessions.map((s) => ({
          id: s.id,
          isCurrent: s.token === currentSessionToken,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ipAddress: s.ipAddress ? s.ipAddress.substring(0, 3) + "***" : null,
          userAgent: s.userAgent ? s.userAgent.substring(0, 50) + "..." : null,
        })),
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to get sessions");
    
    return NextResponse.json(
      { error: "Failed to get sessions" },
      { status: 500 }
    );
  }
}
