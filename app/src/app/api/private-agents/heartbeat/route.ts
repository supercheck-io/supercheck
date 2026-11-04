import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { redactConnectorText } from "@/lib/sre/connectors/output-sanitizer";

import { privateAgentCredentials, privateAgentHeartbeats, privateAgents } from "@/db/schema";
import { db } from "@/utils/db";
import { authenticatePrivateAgent, unauthorized } from "../jobs/auth";
import { allowDeviceAuthRequest } from "@/lib/auth/device-auth-rate-limit";
import { PRIVATE_AGENT_LIMITS } from "@/lib/private-agents/request-limits";
import { knownConnectorTypes } from "@/lib/private-agents/agent-registry";

const heartbeatSchema = z.object({
  agentId: z.string().uuid(),
  status: z.enum(["connected", "unhealthy"]).default("connected"),
  protocolVersion: z.string().trim().min(1).max(30),
  agentVersion: z.string().trim().min(1).max(50),
  activeJobCount: z.number().int().min(0).max(1000).default(0),
  latencyMs: z.number().int().min(0).max(300_000).optional().nullable(),
  // Agents may echo hostnames or tokens from upstream errors; this text is stored and shown in the UI.
  errorCode: z.string().trim().max(100).transform((value) => redactConnectorText(value).slice(0, 100)).optional().nullable(),
  capabilities: z
    .object({
      supportsSreConnectors: z.boolean().default(true),
      supportsHttpMonitoring: z.boolean().default(false),
      supportsPlaywright: z.boolean().default(false),
      supportsK6: z.boolean().default(false),
      supportsNetworkChecks: z.boolean().default(false),
      sreConnectorTypes: z.array(z.string().trim().min(1).max(50)).max(100).optional(),
    })
    .default({
      supportsSreConnectors: true,
      supportsHttpMonitoring: false,
      supportsPlaywright: false,
      supportsK6: false,
      supportsNetworkChecks: false,
    }),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticatePrivateAgent(request);
    if (!auth) {
      return unauthorized();
    }

    if (!(await allowDeviceAuthRequest([PRIVATE_AGENT_LIMITS.heartbeatPerCredential(auth.credential.id)], { failOpen: true }))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
    }

    const body = heartbeatSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
    }

    if (body.data.agentId !== auth.agent.id) {
      return unauthorized();
    }

    const now = new Date();
    const capabilities = { ...body.data.capabilities, sreConnectorTypes: knownConnectorTypes(body.data.capabilities.sreConnectorTypes) };

    const accepted = await db.transaction(async (tx) => {
      const [touched] = await tx
        .update(privateAgents)
        .set({
          status: body.data.status,
          version: body.data.agentVersion,
          supportsSreConnectors: capabilities.supportsSreConnectors,
          supportsHttpMonitoring: capabilities.supportsHttpMonitoring,
          supportsPlaywright: capabilities.supportsPlaywright,
          supportsK6: capabilities.supportsK6,
          supportsNetworkChecks: capabilities.supportsNetworkChecks,
          lastHeartbeatAt: now,
          connectedAt: auth.agent.connectedAt ?? now,
          lastError: body.data.errorCode ?? null,
          // Merged in SQL, not from the auth snapshot, so a concurrent token rotation's metadata is never overwritten.
          metadata: capabilities.sreConnectorTypes
            ? sql`coalesce(${privateAgents.metadata}, '{}'::jsonb) || jsonb_build_object('sreConnectorTypes', ${JSON.stringify(capabilities.sreConnectorTypes)}::jsonb)`
            : sql`coalesce(${privateAgents.metadata}, '{}'::jsonb) - 'sreConnectorTypes'`,
          updatedAt: now,
        })
        // A disable between authentication and this write must not be revived by a late heartbeat.
        .where(and(eq(privateAgents.id, auth.agent.id), ne(privateAgents.status, "disabled")))
        .returning({ id: privateAgents.id });
      if (!touched) return false;

      await tx
        .update(privateAgentCredentials)
        .set({ lastUsedAt: now })
        .where(eq(privateAgentCredentials.id, auth.credential.id));

      await tx.insert(privateAgentHeartbeats).values({
        privateAgentId: auth.agent.id,
        organizationId: auth.credential.organizationId,
        projectId: auth.credential.projectId,
        status: body.data.status,
        protocolVersion: body.data.protocolVersion,
        agentVersion: body.data.agentVersion,
        activeJobCount: body.data.activeJobCount,
        reportedCapabilities: capabilities,
        latencyMs: body.data.latencyMs ?? null,
        errorCode: body.data.errorCode ?? null,
        createdAt: now,
      });
      return true;
    });
    if (!accepted) return unauthorized();

    return NextResponse.json({ ok: true, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Private Agent heartbeat failed:", error);
    return NextResponse.json({ error: "Failed to process heartbeat" }, { status: 500 });
  }
}
