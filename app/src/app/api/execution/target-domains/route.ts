import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUserAuthContext, isAuthError, AuthError } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions-client";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { checkExecutionRateLimit } from "@/lib/execution-rate-limiter";
import { buildExecutionRateLimitResponse } from "@/lib/execution-api-responses";
import { db } from "@/utils/db";
import { executionTargetDomains } from "@/db/schema";
import { registerTargetDomain, verifyRegisteredTarget, TargetDomainError } from "@/lib/execution/target-domain-registry";

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), hostname: z.string().min(1).max(253) }).strict(),
  z.object({ action: z.literal("verify"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("remove"), id: z.string().uuid() }).strict(),
]);

async function requireTargetAdmin() {
  const context = await requireUserAuthContext();
  if (!context.organizationId || context.isCliAuth) return null;
  const role = await getUserOrgRole(context.userId, context.organizationId);
  return role === Role.ORG_OWNER || role === Role.ORG_ADMIN
    ? { ...context, organizationId: context.organizationId } : null;
}

function details(row: typeof executionTargetDomains.$inferSelect) {
  return { id: row.id, hostname: row.hostname, verifiedAt: row.verifiedAt, verifiedUntil: row.verifiedUntil,
    txtName: `_supercheck-load-test.${row.hostname}`, txtValue: `supercheck-load-test=${row.verificationToken}` };
}

function failure(error: unknown) {
  if (isAuthError(error)) {
    const status = error instanceof AuthError ? error.status : 401;
    return NextResponse.json({ error: status === 403 ? "Access denied" : "Authentication required" }, { status });
  }
  if (error instanceof TargetDomainError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Execution target registry failed", error);
  return NextResponse.json({ error: "Unable to access execution targets" }, { status: 500 });
}

export async function GET() {
  try {
    const context = await requireTargetAdmin();
    if (!context) return NextResponse.json({ error: "Organization administrator access required" }, { status: 403 });
    const rows = await db.query.executionTargetDomains.findMany({ where: eq(executionTargetDomains.organizationId, context.organizationId), limit: 20 });
    return NextResponse.json({ success: true, data: rows.map(details) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  try {
    const context = await requireTargetAdmin();
    if (!context) return NextResponse.json({ error: "Organization administrator access required" }, { status: 403 });
    const parsed = mutation.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "A valid execution target action is required" }, { status: 400 });
    const limit = buildExecutionRateLimitResponse(await checkExecutionRateLimit(context.userId, context.organizationId));
    if (limit) return limit;
    const input = parsed.data;
    if (input.action === "remove") {
      const removed = await db.delete(executionTargetDomains).where(and(
        eq(executionTargetDomains.id, input.id), eq(executionTargetDomains.organizationId, context.organizationId),
      )).returning({ id: executionTargetDomains.id });
      if (!removed.length) throw new TargetDomainError("Execution target not found", 404);
      return NextResponse.json({ success: true });
    }
    const row = input.action === "register"
      ? await registerTargetDomain(context.organizationId, input.hostname)
      : await verifyRegisteredTarget(context.organizationId, input.id);
    return NextResponse.json({ success: true, data: details(row) });
  } catch (error) { return failure(error); }
}
