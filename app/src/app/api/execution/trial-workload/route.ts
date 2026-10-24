import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { getExecutionPolicy, ExecutionWorkloadError } from "@/lib/execution/execution-policy";
import { createTrialK6Script, normalizeTrialK6Workload } from "@/lib/execution/trial-k6-workload";
import { checkExecutionRateLimit } from "@/lib/execution-rate-limiter";
import { buildExecutionRateLimitResponse } from "@/lib/execution-api-responses";

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  try {
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("test", "run", context)) {
      return NextResponse.json({ error: "Test execution permission required" }, { status: 403 });
    }
    let workload;
    try { workload = normalizeTrialK6Workload(await request.json()); }
    catch { return NextResponse.json({ error: "Provide an HTTPS GET workload with url, vus (1–5), and durationSeconds (1–300)" }, { status: 400 }); }
    const policy = await getExecutionPolicy(context.organizationId);
    if (policy.tier !== "trial") return NextResponse.json({ error: "An active trial execution entitlement is required" }, { status: 403 });
    if (workload.vus > policy.k6MaxVus || Date.now() + workload.durationSeconds * 1000 > policy.expiresAt.getTime()) {
      return NextResponse.json({ error: "The workload exceeds the trial VU or remaining runtime limit" }, { status: 400 });
    }
    const limited = buildExecutionRateLimitResponse(await checkExecutionRateLimit(context.userId, context.organizationId));
    if (limited) return limited;
    return NextResponse.json({ success: true, script: createTrialK6Script(workload) });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (error instanceof ExecutionWorkloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Trial workload generation failed", error);
    return NextResponse.json({ error: "Unable to generate the trial workload" }, { status: 503 });
  }
}
