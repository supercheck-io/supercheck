import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { privateAgentCredentials, privateAgentHeartbeats, privateAgents } from "@/db/schema";
import { db } from "@/utils/db";
import { authenticatePrivateAgent, unauthorized } from "../jobs/auth";

const heartbeatSchema = z.object({
  agentId: z.string().uuid(),
  status: z.enum(["connected", "unhealthy"]).default("connected"),
  protocolVersion: z.string().trim().min(1).max(30),
  agentVersion: z.string().trim().min(1).max(50),
  activeJobCount: z.number().int().min(0).max(1000).default(0),
  latencyMs: z.number().int().min(0).max(300_000).optional().nullable(),
  errorCode: z.string().trim().max(100).optional().nullable(),
  capabilities: z
    .object({
      supportsSreConnectors: z.boolean().default(true),
      supportsHttpMonitoring: z.boolean().default(false),
      supportsPlaywright: z.boolean().default(false),
      supportsK6: z.boolean().default(false),
      supportsNetworkChecks: z.boolean().default(false),
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

    const body = heartbeatSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
    }

    if (body.data.agentId !== auth.agent.id) {
      return unauthorized();
    }

    const now = new Date();
    const capabilities = body.data.capabilities;

    await db.transaction(async (tx) => {
      await tx
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
          updatedAt: now,
        })
        .where(eq(privateAgents.id, auth.agent.id));

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
    });

    return NextResponse.json({ ok: true, receivedAt: now.toISOString() });
  } catch (error) {
    console.error("Private Agent heartbeat failed:", error);
    return NextResponse.json({ error: "Failed to process heartbeat" }, { status: 500 });
  }
}
