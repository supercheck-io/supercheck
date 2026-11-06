import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { externalConnectorCredentials, externalConnectors, privateAgentCredentials, privateAgentJobs, privateAgents } from "@/db/schema";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { createLogger } from "@/lib/logger/index";
import { decryptConnectorCredential } from "@/lib/sre/connectors";
import { resolveMcpToolCall } from "@/lib/sre/connectors/providers/mcp";
import { db } from "@/utils/db";
import { authenticatePrivateAgent, unauthorized } from "../auth";

const LEASE_TTL_MS = 5 * 60_000;
const MAX_QUEUED_AGE_MS = 10 * 60_000;
const MAX_LONG_POLL_MS = 25_000;
const LONG_POLL_INTERVAL_MS = 1_000;
const logger = createLogger({ module: "private-agent-job-lease" }) as {
  error: (data: unknown, message?: string) => void;
};

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
          .where(and(eq(privateAgents.id, auth.agent.id), ne(privateAgents.status, "disabled")));
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
        // The credential was checked at request start; a disable or rotate may have revoked it since.
        const [activeCredential] = await tx
          .select({ id: privateAgentCredentials.id })
          .from(privateAgentCredentials)
          .where(and(eq(privateAgentCredentials.id, auth.credential.id), isNull(privateAgentCredentials.revokedAt)))
          .limit(1);
        if (!activeCredential) return null;

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

        // Never hand work or credentials to an agent for a disabled connector or a job that waited too long.
        const queued = and(
          eq(privateAgentJobs.privateAgentId, auth.agent.id),
          eq(privateAgentJobs.organizationId, auth.agent.organizationId),
          eq(privateAgentJobs.jobClass, "sre_connector_query"),
          eq(privateAgentJobs.status, "queued")
        );
        await tx
          .update(privateAgentJobs)
          .set({ status: "timed_out", completedAt: now, errorCode: "queued_too_long" })
          .where(and(queued, lt(privateAgentJobs.createdAt, new Date(now.getTime() - MAX_QUEUED_AGE_MS))));
        await tx
          .update(privateAgentJobs)
          .set({ status: "failed", completedAt: now, errorCode: "connector_disabled" })
          .where(and(queued, sql`${privateAgentJobs.connectorId} IN (SELECT id FROM external_connectors WHERE status = 'disabled')`));
        // The connector was moved to another agent, organization or project after the job was queued.
        await tx
          .update(privateAgentJobs)
          .set({ status: "failed", completedAt: now, errorCode: "connector_reassigned" })
          .where(
            and(
              queued,
              sql`${privateAgentJobs.connectorId} IS NOT NULL`,
              sql`NOT EXISTS (SELECT 1 FROM external_connectors ec WHERE ec.id = ${privateAgentJobs.connectorId} AND ec.private_agent_id = ${auth.agent.id} AND ec.organization_id = ${privateAgentJobs.organizationId} AND (ec.project_id IS NULL OR ec.project_id = ${privateAgentJobs.projectId}))`
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
          .where(
            and(
              eq(privateAgentJobs.id, job.id),
              eq(privateAgentJobs.status, "queued"),
              // Re-checked in the UPDATE itself so a concurrent disable or rotate cannot slip between check and lease.
              sql`EXISTS (SELECT 1 FROM private_agent_credentials c JOIN private_agents a ON a.id = c.private_agent_id WHERE c.id = ${auth.credential.id} AND c.revoked_at IS NULL AND a.status <> 'disabled')`
            )
          )
          .returning();

        await tx
          .update(privateAgents)
          .set({ lastHeartbeatAt: now, updatedAt: now })
          .where(and(eq(privateAgents.id, auth.agent.id), ne(privateAgents.status, "disabled")));
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
          orderBy: desc(externalConnectorCredentials.updatedAt),
        })
      : null;
    if (credentialRow?.expiresAt && credentialRow.expiresAt <= new Date()) {
      // Never hand an expired secret to the agent; fail the job so the investigation can proceed without it.
      await db
        .update(privateAgentJobs)
        .set({ status: "failed", completedAt: new Date(), errorCode: "connector_credential_expired" })
        .where(and(eq(privateAgentJobs.id, leasedJob.id), eq(privateAgentJobs.privateAgentId, auth.agent.id)));
      return NextResponse.json({ job: null });
    }

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

    // MCP jobs are stored with the query-redacted endpoint; the agent dials the full URL from the credential.
    const fullEndpoint = credential?.value?.endpointUrl;
    const isMcp = leasedJob.jobSpec?.connectorType === "mcp";
    const storedEndpoint = leasedJob.jobSpec?.endpointUrl;
    const failLeased = async (errorCode: string) => {
      await db
        .update(privateAgentJobs)
        .set({ status: "failed", completedAt: new Date(), errorCode })
        .where(and(eq(privateAgentJobs.id, leasedJob.id), eq(privateAgentJobs.privateAgentId, auth.agent.id)));
      return NextResponse.json({ job: null });
    };
    if (isMcp && typeof storedEndpoint === "string" && storedEndpoint.includes("?") && typeof fullEndpoint !== "string") {
      // The stored URL is query-redacted and the key is gone: the agent could only dial a broken endpoint.
      return failLeased("mcp_endpoint_missing");
    }
    const mcpOperation = (leasedJob.jobSpec?.filters as { mcp?: { kind?: string; tool?: string; arguments?: Record<string, unknown> } } | undefined)?.mcp;
    if (isMcp && mcpOperation?.kind === "call_tool" && leasedJob.connectorId) {
      // Re-check against the connector as it is now: the tool may have been removed or flagged destructive since queueing.
      const connector = await db.query.externalConnectors.findFirst({
        where: eq(externalConnectors.id, leasedJob.connectorId),
        columns: { config: true },
      });
      if (!connector || !resolveMcpToolCall(connector.config, mcpOperation.tool ?? "", mcpOperation.arguments ?? {}).ok) {
        return failLeased("mcp_tool_not_allowed");
      }
    }
    const jobSpec =
      isMcp && typeof fullEndpoint === "string"
        ? { ...leasedJob.jobSpec, endpointUrl: fullEndpoint }
        : leasedJob.jobSpec;

    return NextResponse.json({
      job: {
        id: leasedJob.id,
        jobClass: leasedJob.jobClass,
        connectorId: leasedJob.connectorId,
        projectId: leasedJob.projectId,
        jobSpec,
        jobSpecHash: leasedJob.jobSpecHash,
        policyDecisionHash: leasedJob.policyDecisionHash,
        leaseExpiresAt: leasedJob.leaseExpiresAt?.toISOString() ?? leaseExpiresAt.toISOString(),
        credential,
      },
      leaseToken,
    });
  } catch (error) {
    logger.error({ error }, "Private Agent job lease failed");
    return NextResponse.json({ error: "Failed to lease job" }, { status: 500 });
  }
}
