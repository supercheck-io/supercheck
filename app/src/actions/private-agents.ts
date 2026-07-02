"use server";

import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { privateAgentCredentials, privateAgents } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { buildPrivateAgentRegistrationMetadata } from "@/lib/private-agents/registration-token";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { db } from "@/utils/db";

const privateAgentInputSchema = z.object({
  name: z.string().trim().min(1, "Agent name is required").max(100),
  region: z.string().trim().max(50).optional().nullable(),
  networkLabel: z.string().trim().max(100).optional().nullable(),
  projectScoped: z.boolean().default(true),
});

const privateAgentIdSchema = z.object({
  id: z.string().uuid(),
});

export type PrivateAgentListItem = {
  id: string;
  name: string;
  status: "pending" | "connected" | "disconnected" | "unhealthy" | "disabled";
  version: string | null;
  agentMode: "connector_proxy" | "execution_worker" | "hybrid";
  supportsSreConnectors: boolean;
  region: string | null;
  networkLabel: string | null;
  lastHeartbeatAt: Date | null;
  lastError: string | null;
  projectScoped: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PrivateAgentActionResult =
  | {
      success: true;
      agent: PrivateAgentListItem;
      registrationToken?: string;
      message: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).filter(([, errors]) => errors && errors.length > 0)
  ) as Record<string, string[]>;
}

function generateRegistrationToken() {
  return `scpa_${crypto.randomBytes(32).toString("hex")}`;
}

function normalizeAgent(row: typeof privateAgents.$inferSelect): PrivateAgentListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    version: row.version,
    agentMode: row.agentMode,
    supportsSreConnectors: row.supportsSreConnectors,
    region: row.region,
    networkLabel: row.networkLabel,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastError: row.lastError,
    projectScoped: Boolean(row.projectId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireConnectorConfigurationPermission() {
  const context = await requireProjectContext();
  const canConfigure = checkPermissionWithContext("sre_connector", "configure", {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  });

  if (!canConfigure) {
    return { ...context, allowed: false as const };
  }

  return { ...context, allowed: true as const };
}

export async function getPrivateAgents(): Promise<
  | { success: true; agents: PrivateAgentListItem[] }
  | { success: false; error: string; agents: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_connector", "view", { userId, organizationId, project });

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view Private Agents", agents: [] };
    }

    const agents = await db
      .select()
      .from(privateAgents)
      .where(
        and(
          eq(privateAgents.organizationId, organizationId),
          or(eq(privateAgents.projectId, project.id), isNull(privateAgents.projectId))
        )
      )
      .orderBy(desc(privateAgents.updatedAt));

    return { success: true, agents: agents.map(normalizeAgent) };
  } catch (error) {
    console.error("Error fetching Private Agents:", error);
    return { success: false, error: "Failed to fetch Private Agents", agents: [] };
  }
}

export async function registerPrivateAgent(input: z.infer<typeof privateAgentInputSchema>): Promise<PrivateAgentActionResult> {
  try {
    const parsed = privateAgentInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid Private Agent data", fieldErrors: formatValidationErrors(parsed.error) };
    }

    const context = await requireConnectorConfigurationPermission();
    if (!context.allowed) {
      return { success: false, error: "Insufficient permissions to register Private Agents" };
    }

    const token = generateRegistrationToken();
    const tokenHash = hashApiKey(token);
    const now = new Date();

    const agent = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(privateAgents)
        .values({
          organizationId: context.organizationId,
          projectId: parsed.data.projectScoped ? context.project.id : null,
          name: parsed.data.name,
          status: "pending",
          registrationTokenHash: tokenHash,
          agentMode: "connector_proxy",
          supportsSreConnectors: true,
          supportsHttpMonitoring: false,
          supportsPlaywright: false,
          supportsK6: false,
          supportsNetworkChecks: false,
          region: normalizeOptional(parsed.data.region),
          networkLabel: normalizeOptional(parsed.data.networkLabel),
          metadata: buildPrivateAgentRegistrationMetadata({}, now),
          createdByUserId: context.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return created;
    });

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "private_agent_registered",
      resource: "private_agent",
      resourceId: agent.id,
      metadata: {
        projectId: context.project.id,
        agentName: agent.name,
        projectScoped: Boolean(agent.projectId),
      },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/private-agents");
    revalidatePath("/org-admin/integrations");
    return {
      success: true,
      agent: normalizeAgent(agent),
      registrationToken: token,
      message: "Private Agent registered. Copy the short-lived registration token now; it will not be shown again.",
    };
  } catch (error) {
    console.error("Error registering Private Agent:", error);
    return { success: false, error: "Failed to register Private Agent" };
  }
}

export async function rotatePrivateAgentToken(input: z.infer<typeof privateAgentIdSchema>): Promise<PrivateAgentActionResult> {
  try {
    const parsed = privateAgentIdSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid Private Agent ID" };
    }

    const context = await requireConnectorConfigurationPermission();
    if (!context.allowed) {
      return { success: false, error: "Insufficient permissions to rotate Private Agent tokens" };
    }

    const current = await db.query.privateAgents.findFirst({
      where: and(
        eq(privateAgents.id, parsed.data.id),
        eq(privateAgents.organizationId, context.organizationId),
        or(eq(privateAgents.projectId, context.project.id), isNull(privateAgents.projectId))
      ),
    });

    if (!current || current.status === "disabled") {
      return { success: false, error: "Private Agent not found or disabled" };
    }

    const token = generateRegistrationToken();
    const tokenHash = hashApiKey(token);
    const now = new Date();

    const agent = await db.transaction(async (tx) => {
      await tx
        .update(privateAgentCredentials)
        .set({ revokedAt: now, revocationReason: "rotated", revokedByUserId: context.userId })
        .where(and(eq(privateAgentCredentials.privateAgentId, current.id), isNull(privateAgentCredentials.revokedAt)));

      const [updated] = await tx
        .update(privateAgents)
        .set({
          registrationTokenHash: tokenHash,
          status: "pending",
          registeredAt: null,
          connectedAt: null,
          metadata: buildPrivateAgentRegistrationMetadata(current.metadata, now),
          updatedAt: now,
        })
        .where(eq(privateAgents.id, current.id))
        .returning();

      return updated;
    });

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "private_agent_token_rotated",
      resource: "private_agent",
      resourceId: agent.id,
      metadata: { projectId: context.project.id, agentName: agent.name },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/private-agents");
    return {
      success: true,
      agent: normalizeAgent(agent),
      registrationToken: token,
      message: "Private Agent registration token rotated. Copy the short-lived token now; it will not be shown again.",
    };
  } catch (error) {
    console.error("Error rotating Private Agent token:", error);
    return { success: false, error: "Failed to rotate Private Agent token" };
  }
}

export async function disablePrivateAgent(input: z.infer<typeof privateAgentIdSchema>): Promise<PrivateAgentActionResult> {
  try {
    const parsed = privateAgentIdSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid Private Agent ID" };
    }

    const context = await requireConnectorConfigurationPermission();
    if (!context.allowed) {
      return { success: false, error: "Insufficient permissions to disable Private Agents" };
    }

    const agent = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(privateAgents)
        .set({ status: "disabled", disabledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(privateAgents.id, parsed.data.id),
            eq(privateAgents.organizationId, context.organizationId),
            or(eq(privateAgents.projectId, context.project.id), isNull(privateAgents.projectId))
          )
        )
        .returning();

      if (updated) {
        await tx
          .update(privateAgentCredentials)
          .set({ revokedAt: new Date(), revocationReason: "agent_disabled", revokedByUserId: context.userId })
          .where(and(eq(privateAgentCredentials.privateAgentId, updated.id), isNull(privateAgentCredentials.revokedAt)));
      }

      return updated;
    });

    if (!agent) {
      return { success: false, error: "Private Agent not found or access denied" };
    }

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "private_agent_disabled",
      resource: "private_agent",
      resourceId: agent.id,
      metadata: { projectId: context.project.id, agentName: agent.name },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/private-agents");
    revalidatePath("/org-admin/integrations");
    return { success: true, agent: normalizeAgent(agent), message: "Private Agent disabled" };
  } catch (error) {
    console.error("Error disabling Private Agent:", error);
    return { success: false, error: "Failed to disable Private Agent" };
  }
}
