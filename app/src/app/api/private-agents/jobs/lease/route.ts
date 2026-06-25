import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { externalConnectorCredentials, privateAgentCredentials, privateAgentJobs, privateAgents } from "@/db/schema";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { decryptConnectorCredential } from "@/lib/sre/connectors";
import { db } from "@/utils/db";
import { authenticatePrivateAgent, unauthorized } from "../auth";

const LEASE_TTL_MS = 5 * 60_000;
const MAX_LONG_POLL_MS = 25_000;
const LONG_POLL_INTERVAL_MS = 1_000;

const leaseRequestSchema = z.object({
  waitMs: z.number().int().min(0).max(MAX_LONG_POLL_MS).default(0),
});

function generateLeaseToken() {
  return `scl_${crypto.randomBytes(32).toString("hex")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticatePrivateAgent(request);
    if (!auth) {
      return unauthorized();
    }

    if (!auth.agent.supportsSreConnectors) {
      return NextResponse.json({ error: "Agent does not support SRE connector jobs" }, { status: 403 });
    }

    let parsedBody: z.infer<typeof leaseRequestSchema> = { waitMs: 0 };
    try {
      const body = leaseRequestSchema.safeParse(await request.json());
      if (!body.success) {
        return NextResponse.json({ error: "Invalid lease request payload" }, { status: 400 });
      }
      parsedBody = body.data;
    } catch {
      parsedBody = { waitMs: 0 };
    }

    const touchAgent = async (now: Date) => {
      await db.transaction(async (tx) => {
        await tx
          .update(privateAgents)
          .set({ lastHeartbeatAt: now, updatedAt: now })
          .where(eq(privateAgents.id, auth.agent.id));
        await tx
          .update(privateAgentCredentials)
          .set({ lastUsedAt: now })
          .where(eq(privateAgentCredentials.id, auth.credential.id));
      });
    };

    const tryLeaseJob = async () => {
      const leaseToken = generateLeaseToken();
      const leaseTokenHash = hashApiKey(leaseToken);
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);

      const leasedJob = await db.transaction(async (tx) => {
        await tx
          .update(privateAgentJobs)
          .set({
            status: "queued",
            leaseTokenHash: null,
            leaseExpiresAt: null,
            startedAt: null,
          })
          .where(
            and(
              eq(privateAgentJobs.privateAgentId, auth.agent.id),
              eq(privateAgentJobs.organizationId, auth.agent.organizationId),
              eq(privateAgentJobs.jobClass, "sre_connector_query"),
              inArray(privateAgentJobs.status, ["leased", "running"]),
              lte(privateAgentJobs.leaseExpiresAt, now)
            )
          );

        const [job] = await tx
          .select()
          .from(privateAgentJobs)
          .where(
            and(
              eq(privateAgentJobs.privateAgentId, auth.agent.id),
              eq(privateAgentJobs.organizationId, auth.agent.organizationId),
              eq(privateAgentJobs.jobClass, "sre_connector_query"),
              eq(privateAgentJobs.status, "queued")
            )
          )
          .orderBy(asc(privateAgentJobs.createdAt))
          .limit(1);

        if (!job) {
          return null;
        }

        const [updated] = await tx
          .update(privateAgentJobs)
          .set({
            status: "leased",
            leaseTokenHash,
            leaseExpiresAt,
            startedAt: now,
          })
          .where(and(eq(privateAgentJobs.id, job.id), eq(privateAgentJobs.status, "queued")))
          .returning();

        await tx
          .update(privateAgents)
          .set({ lastHeartbeatAt: now, updatedAt: now })
          .where(eq(privateAgents.id, auth.agent.id));
        await tx
          .update(privateAgentCredentials)
          .set({ lastUsedAt: now })
          .where(eq(privateAgentCredentials.id, auth.credential.id));

        return updated ?? null;
      });

      return leasedJob ? { leasedJob, leaseToken, leaseExpiresAt } : null;
    };

    const deadline = Date.now() + parsedBody.waitMs;
    let leased = await tryLeaseJob();
    while (!leased && Date.now() < deadline) {
      await sleep(Math.min(LONG_POLL_INTERVAL_MS, deadline - Date.now()));
      leased = await tryLeaseJob();
    }

    if (!leased) {
      await touchAgent(new Date());
      return NextResponse.json({ job: null });
    }

    const { leasedJob, leaseToken, leaseExpiresAt } = leased;

    const credentialRow = leasedJob.connectorId
      ? await db.query.externalConnectorCredentials.findFirst({
          where: eq(externalConnectorCredentials.connectorId, leasedJob.connectorId),
        })
      : null;
    const credential = credentialRow
      ? {
          credentialType: credentialRow.credentialType,
          value: decryptConnectorCredential(credentialRow.encryptedCredential, {
            organizationId: leasedJob.organizationId,
            projectId: leasedJob.projectId,
            connectorId: leasedJob.connectorId ?? "",
          }),
        }
      : null;

    return NextResponse.json({
      job: {
        id: leasedJob.id,
        jobClass: leasedJob.jobClass,
        connectorId: leasedJob.connectorId,
        projectId: leasedJob.projectId,
        jobSpec: leasedJob.jobSpec,
        jobSpecHash: leasedJob.jobSpecHash,
        policyDecisionHash: leasedJob.policyDecisionHash,
        leaseExpiresAt: leasedJob.leaseExpiresAt?.toISOString() ?? leaseExpiresAt.toISOString(),
        credential,
      },
      leaseToken,
    });
  } catch (error) {
    console.error("Private Agent job lease failed:", error);
    return NextResponse.json({ error: "Failed to lease job" }, { status: 500 });
  }
}
