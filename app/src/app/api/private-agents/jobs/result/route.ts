import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { privateAgentCredentials, privateAgentJobs, privateAgents } from "@/db/schema";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { hashConnectorPayload } from "@/lib/sre/connectors";
import { db } from "@/utils/db";
import { authenticatePrivateAgent, unauthorized } from "../auth";

const evidenceSummarySchema = z.object({
  id: z.string().min(1).max(200),
  sourceUri: z.string().min(1).max(1000),
  title: z.string().min(1).max(500),
  summary: z.string().max(2000),
  evidenceType: z.string().min(1).max(30),
  observedAt: z.string().datetime(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/i),
});

const resultSchema = z.object({
  jobId: z.string().uuid(),
  leaseToken: z.string().min(20).max(200),
  status: z.enum(["completed", "failed", "cancelled", "timed_out"]),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/i).optional().nullable(),
  evidence: z.array(evidenceSummarySchema).max(100).optional().default([]),
  truncated: z.boolean().optional().default(false),
  errorCode: z.string().trim().max(100).optional().nullable(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticatePrivateAgent(request);
    if (!auth) {
      return unauthorized();
    }

    const rawBody = await request.json().catch(() => null);
    const body = resultSchema.safeParse(rawBody);
    if (!body.success) {
      return NextResponse.json({ error: "Invalid job result payload" }, { status: 400 });
    }

    const now = new Date();
    const leaseTokenHash = hashApiKey(body.data.leaseToken);

    const loadJob = () => db
      .select()
      .from(privateAgentJobs)
      .where(
        and(
          eq(privateAgentJobs.id, body.data.jobId),
          eq(privateAgentJobs.privateAgentId, auth.agent.id),
          eq(privateAgentJobs.organizationId, auth.agent.organizationId),
          eq(privateAgentJobs.leaseTokenHash, leaseTokenHash),
        )
      )
      .limit(1);
    const [job] = await loadJob();

    const resultSummary = {
      evidence: body.data.evidence,
      truncated: body.data.truncated,
      receivedAt: now.toISOString(),
    };
    const resultPayloadHash = hashConnectorPayload({ evidence: body.data.evidence, truncated: body.data.truncated });
    const resultHash = body.data.resultHash ?? resultPayloadHash;
    const matchesResult = (stored: typeof job | undefined) => stored &&
      stored.status === body.data.status &&
      stored.resultHash === resultHash &&
      (stored.errorCode ?? null) === (body.data.errorCode ?? null) &&
      (body.data.durationMs == null || stored.durationMs === body.data.durationMs) &&
      hashConnectorPayload({ evidence: stored.resultSummary?.evidence, truncated: stored.resultSummary?.truncated }) === resultPayloadHash;

    // A lost response may replay the same result after the lease expired.
    if (matchesResult(job)) {
      return NextResponse.json({ ok: true, alreadyAccepted: true });
    }
    if (!job || !["leased", "running"].includes(job.status) || !job.leaseExpiresAt || job.leaseExpiresAt < now) {
      return NextResponse.json({ error: "Job lease is invalid or expired" }, { status: 409 });
    }

    const accepted = await db.transaction(async (tx) => {
      // Re-assert lease ownership and state in the UPDATE so concurrent or
      // replayed result posts cannot overwrite a job that already finished.
      const updated = await tx
        .update(privateAgentJobs)
        .set({
          status: body.data.status,
          completedAt: now,
          durationMs: body.data.durationMs ?? (job.startedAt ? now.getTime() - job.startedAt.getTime() : null),
          errorCode: body.data.errorCode ?? null,
          resultHash,
          resultSummary,
        })
        .where(
          and(
            eq(privateAgentJobs.id, job.id),
            eq(privateAgentJobs.leaseTokenHash, leaseTokenHash),
            inArray(privateAgentJobs.status, ["leased", "running"])
          )
        )
        .returning({ id: privateAgentJobs.id });

      if (updated.length === 0) {
        return false;
      }

      await tx
        .update(privateAgents)
        .set({ lastHeartbeatAt: now, updatedAt: now, lastError: body.data.status === "completed" ? null : body.data.errorCode ?? body.data.status })
        .where(eq(privateAgents.id, auth.agent.id));
      await tx
        .update(privateAgentCredentials)
        .set({ lastUsedAt: now })
        .where(eq(privateAgentCredentials.id, auth.credential.id));
      return true;
    });

    if (!accepted) {
      const [stored] = await loadJob();
      if (matchesResult(stored)) {
        return NextResponse.json({ ok: true, alreadyAccepted: true });
      }
      return NextResponse.json({ error: "Job lease is invalid or expired" }, { status: 409 });
    }

    return NextResponse.json({ ok: true, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Private Agent job result failed:", error);
    return NextResponse.json({ error: "Failed to record job result" }, { status: 500 });
  }
}
