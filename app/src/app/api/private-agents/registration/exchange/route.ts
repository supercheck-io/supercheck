import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { privateAgentCredentials, privateAgents } from "@/db/schema";
import {
  getPrivateAgentRegistrationTokenExpiresAt,
  incrementPrivateAgentRegistrationAttempts,
  markPrivateAgentRegistrationExchanged,
} from "@/lib/private-agents/registration-token";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { db } from "@/utils/db";
import { getBearerToken, unauthorized } from "../../jobs/auth";

const exchangeSchema = z.object({
  agentId: z.string().uuid(),
  protocolVersion: z.string().trim().min(1).max(30),
  agentVersion: z.string().trim().min(1).max(50),
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

function generateRuntimeSecret() {
  return `scpac_${crypto.randomBytes(32).toString("hex")}`;
}

function generateKeyId() {
  return `pa_${crypto.randomBytes(8).toString("hex")}`;
}

function tokenHashesMatch(left: string | null, right: string) {
  if (!left || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return unauthorized();
    }

    const body = exchangeSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json({ error: "Invalid registration exchange payload" }, { status: 400 });
    }

    const now = new Date();
    const registrationTokenHash = hashApiKey(token);
    const runtimeSecret = generateRuntimeSecret();
    const runtimeSecretHash = hashApiKey(runtimeSecret);
    const keyId = generateKeyId();

    const result = await db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(privateAgents)
        .where(eq(privateAgents.id, body.data.agentId))
        .limit(1);

      if (!agent) {
        return { status: "unauthorized" as const };
      }

      if (agent.status === "disabled") {
        return { status: "disabled" as const };
      }

      if (!tokenHashesMatch(agent.registrationTokenHash, registrationTokenHash)) {
        await tx
          .update(privateAgents)
          .set({
            metadata: incrementPrivateAgentRegistrationAttempts(agent.metadata, now, "invalid_token"),
            updatedAt: now,
          })
          .where(eq(privateAgents.id, agent.id));
        return { status: "unauthorized" as const };
      }

      const expiresAt = getPrivateAgentRegistrationTokenExpiresAt(agent.metadata);
      if (!expiresAt || expiresAt <= now) {
        await tx
          .update(privateAgents)
          .set({
            metadata: incrementPrivateAgentRegistrationAttempts(agent.metadata, now, "expired_token"),
            updatedAt: now,
          })
          .where(eq(privateAgents.id, agent.id));
        return { status: "expired" as const };
      }

      const [updated] = await tx
        .update(privateAgents)
        .set({
          registrationTokenHash: null,
          status: "connected",
          version: body.data.agentVersion,
          supportsSreConnectors: body.data.capabilities.supportsSreConnectors,
          supportsHttpMonitoring: body.data.capabilities.supportsHttpMonitoring,
          supportsPlaywright: body.data.capabilities.supportsPlaywright,
          supportsK6: body.data.capabilities.supportsK6,
          supportsNetworkChecks: body.data.capabilities.supportsNetworkChecks,
          registeredAt: now,
          connectedAt: now,
          lastHeartbeatAt: now,
          lastError: null,
          metadata: markPrivateAgentRegistrationExchanged(agent.metadata, now),
          updatedAt: now,
        })
        .where(and(eq(privateAgents.id, agent.id), eq(privateAgents.registrationTokenHash, registrationTokenHash)))
        .returning();

      if (!updated || updated.id !== agent.id) {
        return { status: "replayed" as const };
      }

      await tx
        .update(privateAgentCredentials)
        .set({ revokedAt: now, revocationReason: "registration_exchanged" })
        .where(and(eq(privateAgentCredentials.privateAgentId, agent.id), isNull(privateAgentCredentials.revokedAt)));

      await tx.insert(privateAgentCredentials).values({
        privateAgentId: agent.id,
        organizationId: agent.organizationId,
        projectId: agent.projectId,
        keyId,
        secretHash: runtimeSecretHash,
        issuedAt: now,
      });

      return { status: "ok" as const, agent: updated };
    });

    if (result.status === "disabled") {
      return NextResponse.json({ error: "Private Agent is disabled" }, { status: 403 });
    }
    if (result.status === "expired") {
      return NextResponse.json({ error: "Registration token expired" }, { status: 410 });
    }
    if (result.status !== "ok") {
      return unauthorized();
    }

    return NextResponse.json({
      token: runtimeSecret,
      keyId,
      agent: {
        id: result.agent.id,
        status: result.agent.status,
        registeredAt: result.agent.registeredAt?.toISOString() ?? now.toISOString(),
      },
    });
  } catch (error) {
    console.error("Private Agent registration exchange failed:", error);
    return NextResponse.json({ error: "Failed to exchange registration token" }, { status: 500 });
  }
}
