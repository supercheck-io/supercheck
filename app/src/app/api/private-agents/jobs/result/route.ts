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

    const body = resultSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid job result payload" }, { status: 400 });
    }

    const now = new Date();
    const leaseTokenHash = hashApiKey(body.data.leaseToken);

    const [job] = await db
      .select()
      .from(privateAgentJobs)
      .where(
        and(
          eq(privateAgentJobs.id, body.data.jobId),
          eq(privateAgentJobs.privateAgentId, auth.agent.id),
          eq(privateAgentJobs.organizationId, auth.agent.organizationId),
          eq(privateAgentJobs.leaseTokenHash, leaseTokenHash),
          inArray(privateAgentJobs.status, ["leased", "running"])
        )
      )
      .limit(1);

    if (!job || !job.leaseExpiresAt || job.leaseExpiresAt < now) {
      return NextResponse.json({ error: "Job lease is invalid or expired" }, { status: 409 });
    }

    const resultSummary = {
      evidence: body.data.evidence,
      truncated: body.data.truncated,
      receivedAt: now.toISOString(),
    };
    const resultHash = body.data.resultHash ?? hashConnectorPayload(resultSummary);

    await db.transaction(async (tx) => {
      await tx
        .update(privateAgentJobs)
        .set({
          status: body.data.status,
          completedAt: now,
          durationMs: body.data.durationMs ?? (job.startedAt ? now.getTime() - job.startedAt.getTime() : null),
          errorCode: body.data.errorCode ?? null,
          resultHash,
          resultSummary,
        })
        .where(eq(privateAgentJobs.id, job.id));

      await tx
        .update(privateAgents)
        .set({ lastHeartbeatAt: now, updatedAt: now, lastError: body.data.status === "completed" ? null : body.data.errorCode ?? body.data.status })
        .where(eq(privateAgents.id, auth.agent.id));
      await tx
        .update(privateAgentCredentials)
        .set({ lastUsedAt: now })
        .where(eq(privateAgentCredentials.id, auth.credential.id));
    });

    return NextResponse.json({ ok: true, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Private Agent job result failed:", error);
    return NextResponse.json({ error: "Failed to record job result" }, { status: 500 });
  }
}
