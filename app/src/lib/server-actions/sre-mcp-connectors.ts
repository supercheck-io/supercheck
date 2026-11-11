import "server-only";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { externalConnectors, externalConnectorServices } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { normalizePrivateAgentEvidenceSummaries } from "@/lib/sre/connector-job-evidence";
import { assertEndpointAllowedForExecution } from "@/lib/sre/connectors";
import {
  MAX_MCP_ALLOWLIST_TOOLS,
  MCP_DISCOVERY_SERVICE_ID,
  buildAllowlist,
  markDestructiveAllowlistEntries,
  parseDiscoveredTools,
  readMcpConfig,
  type McpConnectorConfig,
} from "@/lib/sre/connectors/providers/mcp";
import {
  loadMcpJob,
  mcpEndpointUrl,
  queueMcpPrivateAgentJob,
} from "@/lib/sre/mcp-private-agent-job";
import { waitForPrivateAgentConnectorJob } from "@/lib/sre/private-agent-job-waiter";
import { checkSreConnectorValidationRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const connectorIdSchema = z.object({ id: z.string().uuid() });

const saveAllowlistSchema = z.object({
  id: z.string().uuid(),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        fixedArguments: z
          .record(
            z.string().max(100),
            z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
          )
          .optional(),
      }),
    )
    .max(MAX_MCP_ALLOWLIST_TOOLS),
});

export type SreMcpToolState = {
  discoveredAt: string | null;
  discovered: McpConnectorConfig["discovered"];
  allowlist: Array<{
    name: string;
    description: string;
    fixedArguments: Record<string, string | number | boolean | null>;
  }>;
};

export type SreMcpActionResult =
  | { success: true; state: SreMcpToolState; message: string }
  | { success: false; error: string };

function toState(config: Record<string, unknown> | null | undefined): SreMcpToolState {
  const parsed = readMcpConfig(config);
  return {
    discoveredAt: parsed.discoveredAt,
    discovered: parsed.discovered,
    allowlist: parsed.allowlist.map(({ name, description, fixedArguments }) => ({
      name,
      description,
      fixedArguments,
    })),
  };
}

async function loadMcpConnector(id: string) {
  const { userId, organizationId, orgPendingDeletion, project } = await requireProjectContext();
  if (!checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, orgPendingDeletion, project })) {
    return { ok: false as const, error: "Insufficient permissions to configure connectors" as const };
  }
  const connector = await db.query.externalConnectors.findFirst({
    where: and(
      eq(externalConnectors.id, id),
      eq(externalConnectors.organizationId, organizationId),
      eq(externalConnectors.projectId, project.id),
    ),
  });
  if (!connector || connector.type !== "mcp" || connector.status === "disabled") {
    return { ok: false as const, error: "MCP connector not found or disabled" as const };
  }
  if (!connector.privateAgentId) {
    return { ok: false as const, error: "MCP connectors can only run through a Private Agent" as const };
  }
  return { ok: true as const, userId, organizationId, orgPendingDeletion, project, connector };
}

export async function getSreMcpToolState(
  input: z.infer<typeof connectorIdSchema>,
): Promise<SreMcpActionResult> {
  try {
    const parsed = connectorIdSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid connector ID" };
    const loaded = await loadMcpConnector(parsed.data.id);
    if (!loaded.ok) return { success: false, error: loaded.error };
    return { success: true, state: toState(loaded.connector.config), message: "Loaded" };
  } catch (error) {
    console.error("Error loading MCP tool state:", error);
    return { success: false, error: "Failed to load MCP tools" };
  }
}

export async function discoverSreMcpTools(
  input: z.infer<typeof connectorIdSchema>,
): Promise<SreMcpActionResult> {
  try {
    const parsed = connectorIdSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid connector ID" };
    const loaded = await loadMcpConnector(parsed.data.id);
    if (!loaded.ok) return { success: false, error: loaded.error };
    const { userId, organizationId, orgPendingDeletion, project, connector } = loaded;

    const rateLimit = await checkSreConnectorValidationRateLimit(userId, connector.id);
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: rateLimit.unavailable
          ? "Connector rate limiter is temporarily unavailable. Try again shortly."
          : "Discovery rate limit reached. Wait a moment and try again.",
      };
    }

    await assertEndpointAllowedForExecution(mcpEndpointUrl(connector), true);

    const scopeRows = await db
      .select({ serviceId: externalConnectorServices.serviceId })
      .from(externalConnectorServices)
      .where(
        and(
          eq(externalConnectorServices.organizationId, organizationId),
          eq(externalConnectorServices.projectId, project.id),
          eq(externalConnectorServices.connectorId, connector.id),
        ),
      );
    // Discovery lists tools only. The sentinel service id keeps its output out
    // of incident evidence imports.
    const queued = await queueMcpPrivateAgentJob({
      organizationId,
      projectId: project.id,
      connector,
      scopedServiceIds: scopeRows.map((row) => row.serviceId),
      serviceId: MCP_DISCOVERY_SERVICE_ID,
      query: "mcp:tools/list",
      operation: { kind: "discover" },
      budget: { maxRows: 50, maxBytes: 512_000, maxSeconds: 20 },
      authorizedBy: "user",
      userId,
      policyDecision: { kind: "mcp_discover" },
    });

    const result = await waitForPrivateAgentConnectorJob({
      timeoutMs: 25_000,
      load: loadMcpJob({
        jobId: queued.jobId,
        organizationId,
        projectId: project.id,
        privateAgentId: queued.privateAgentId,
        connectorId: connector.id,
      }),
    });

    if (result.state === "failed" || result.state === "missing") {
      const code = result.state === "failed" ? result.job.errorCode : null;
      return {
        success: false,
        error:
          code === "connector_credential_expired"
            ? "Connector credential expired. Rotate it and try again."
            : "Tool discovery failed. Check the endpoint, credential and Private Agent.",
      };
    }
    if (result.state === "pending") {
      return {
        success: false,
        error: "The Private Agent has not picked up the discovery job yet. Try again shortly.",
      };
    }

    const discovered = parseDiscoveredTools(
      normalizePrivateAgentEvidenceSummaries(result.job.resultSummary, 50),
    );
    // Lock the row and re-read after the wait: only the mcp key is merged, so a concurrent
    // allowlist save or endpoint rotation is not overwritten.
    const config = await db.transaction(async (tx) => {
      const [fresh] = await tx
        .select({ config: externalConnectors.config })
        .from(externalConnectors)
        .where(
          and(
            eq(externalConnectors.id, connector.id),
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id),
          ),
        )
        .for("update");
      const freshConfig = fresh?.config ?? connector.config ?? {};
      const previous = readMcpConfig(freshConfig);
      const merged: Record<string, unknown> = {
        ...freshConfig,
        mcp: {
          ...previous,
          discovered,
          discoveredAt: new Date().toISOString(),
          allowlist: markDestructiveAllowlistEntries(previous.allowlist, discovered),
        },
      };
      await tx
        .update(externalConnectors)
        .set({
          config: merged,
          status: "valid",
          lastValidatedAt: new Date(),
          lastValidationStatus: "valid",
          lastValidationError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(externalConnectors.id, connector.id),
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id),
          ),
        );
      return merged;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_mcp_tools_discovered",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: { projectId: project.id, toolCount: discovered.length },
      success: true,
    });

    revalidatePath("/org-admin/integrations");
    return {
      success: true,
      state: toState(config),
      message: `Discovered ${discovered.length} tool(s). Nothing is callable until you allowlist it.`,
    };
  } catch (error) {
    console.error("Error discovering MCP tools:", error);
    return { success: false, error: "Failed to discover MCP tools" };
  }
}

export async function saveSreMcpToolAllowlist(
  input: z.infer<typeof saveAllowlistSchema>,
): Promise<SreMcpActionResult> {
  try {
    const parsed = saveAllowlistSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid allowlist" };
    const loaded = await loadMcpConnector(parsed.data.id);
    if (!loaded.ok) return { success: false, error: loaded.error };
    const { userId, organizationId, orgPendingDeletion, project, connector } = loaded;

    // Lock the row and merge only the mcp allowlist into the freshly read config.
    const saved = await db.transaction(async (tx) => {
      const [fresh] = await tx
        .select({ config: externalConnectors.config })
        .from(externalConnectors)
        .where(
          and(
            eq(externalConnectors.id, connector.id),
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id),
          ),
        )
        .for("update");
      const freshConfig = fresh?.config ?? connector.config ?? {};
      const previous = readMcpConfig(freshConfig);
      const built = buildAllowlist(previous.discovered, parsed.data.tools, previous.allowlist);
      if (!built.ok) return built;
      const merged: Record<string, unknown> = { ...freshConfig, mcp: { ...previous, allowlist: built.allowlist } };
      await tx
        .update(externalConnectors)
        .set({ config: merged, updatedAt: new Date() })
        .where(
          and(
            eq(externalConnectors.id, connector.id),
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id),
          ),
        );
      return { ok: true as const, allowlist: built.allowlist, config: merged };
    });
    if (!saved.ok) return { success: false, error: saved.error };
    const { config } = saved;
    const built = saved;

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_mcp_allowlist_updated",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: {
        projectId: project.id,
        tools: built.allowlist.map((tool) => tool.name),
      },
      success: true,
    });

    revalidatePath("/org-admin/integrations");
    return {
      success: true,
      state: toState(config),
      message: `${built.allowlist.length} tool(s) allowlisted`,
    };
  } catch (error) {
    console.error("Error saving MCP allowlist:", error);
    return { success: false, error: "Failed to save allowlist" };
  }
}
