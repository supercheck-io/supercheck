"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { diagnosticQueries, externalConnectors } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext, type ProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { isDiagnosticQueryTypeCompatible } from "@/lib/sre/connectors/diagnostic-query-adapters";
import { validateDiagnosticQueryParameterSchema, validateTemplatePlaceholderCoverage } from "@/lib/sre/connectors/diagnostic-query";
import { db } from "@/utils/db";

const diagnosticQueryTypes = ["sql", "promql", "logql", "traceql", "http_get"] as const;

const flatJsonSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(200), z.number(), z.boolean()])).max(50)])
);

const parameterSchemaJson: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

const createDiagnosticQuerySchema = z.object({
  connectorId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(150),
  queryType: z.enum(diagnosticQueryTypes),
  template: z.string().trim().min(1, "Template is required").max(5000),
  parameterSchema: parameterSchemaJson.default({}),
  allowlist: flatJsonSchema.refine((value) => Object.keys(value).length > 0, "Allowlist is required"),
  maxRows: z.number().int().min(1).max(1000).default(100),
  maxBytes: z.number().int().min(1024).max(5 * 1024 * 1024).default(1024 * 1024),
  maxSeconds: z.number().int().min(1).max(30).default(10),
});

const disableDiagnosticQuerySchema = z.object({ id: z.string().uuid() });

export type SreDiagnosticQueryListItem = {
  id: string;
  connectorId: string;
  connectorName: string;
  connectorType: string;
  name: string;
  queryType: (typeof diagnosticQueryTypes)[number];
  template: string;
  parameterSchema: Record<string, unknown>;
  allowlist: Record<string, unknown>;
  maxRows: number;
  maxBytes: number;
  maxSeconds: number;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
};

export type SreDiagnosticQueryActionResult =
  | { success: true; query?: SreDiagnosticQueryListItem; message: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreDiagnosticQuerySetupOptions = {
  connectors: Array<{ id: string; name: string; type: string; status: string }>;
};

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(Object.entries(flattened).filter(([, errors]) => errors && errors.length > 0)) as Record<string, string[]>;
}

function assertCanConfigureDiagnosticQueries(userId: string, organizationId: string, project: ProjectContext) {
  const canConfigure = checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, project });
  if (!canConfigure) {
    throw new Error("Insufficient permissions to configure SRE diagnostic queries");
  }
}

async function getDiagnosticQueryListItem(id: string, organizationId: string, projectId: string): Promise<SreDiagnosticQueryListItem | null> {
  const [row] = await db
    .select({
      id: diagnosticQueries.id,
      connectorId: diagnosticQueries.connectorId,
      connectorName: externalConnectors.name,
      connectorType: externalConnectors.type,
      name: diagnosticQueries.name,
      queryType: diagnosticQueries.queryType,
      template: diagnosticQueries.template,
      parameterSchema: diagnosticQueries.parameterSchema,
      allowlist: diagnosticQueries.allowlist,
      maxRows: diagnosticQueries.maxRows,
      maxBytes: diagnosticQueries.maxBytes,
      maxSeconds: diagnosticQueries.maxSeconds,
      status: diagnosticQueries.status,
      createdAt: diagnosticQueries.createdAt,
      updatedAt: diagnosticQueries.updatedAt,
    })
    .from(diagnosticQueries)
    .innerJoin(externalConnectors, eq(diagnosticQueries.connectorId, externalConnectors.id))
    .where(and(eq(diagnosticQueries.id, id), eq(diagnosticQueries.organizationId, organizationId), eq(diagnosticQueries.projectId, projectId)))
    .limit(1);

  return row ?? null;
}

export async function getSreDiagnosticQueries(): Promise<
  | { success: true; queries: SreDiagnosticQueryListItem[] }
  | { success: false; error: string; queries: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureDiagnosticQueries(userId, organizationId, project);

    const rows = await db
      .select({
        id: diagnosticQueries.id,
        connectorId: diagnosticQueries.connectorId,
        connectorName: externalConnectors.name,
        connectorType: externalConnectors.type,
        name: diagnosticQueries.name,
        queryType: diagnosticQueries.queryType,
        template: diagnosticQueries.template,
        parameterSchema: diagnosticQueries.parameterSchema,
        allowlist: diagnosticQueries.allowlist,
        maxRows: diagnosticQueries.maxRows,
        maxBytes: diagnosticQueries.maxBytes,
        maxSeconds: diagnosticQueries.maxSeconds,
        status: diagnosticQueries.status,
        createdAt: diagnosticQueries.createdAt,
        updatedAt: diagnosticQueries.updatedAt,
      })
      .from(diagnosticQueries)
      .innerJoin(externalConnectors, eq(diagnosticQueries.connectorId, externalConnectors.id))
      .where(and(eq(diagnosticQueries.organizationId, organizationId), eq(diagnosticQueries.projectId, project.id)))
      .orderBy(desc(diagnosticQueries.createdAt))
      .limit(100);

    return { success: true, queries: rows };
  } catch (error) {
    console.error("Error fetching SRE diagnostic queries:", error);
    return { success: false, error: "Failed to fetch diagnostic queries", queries: [] };
  }
}

export async function getSreDiagnosticQuerySetupOptions(): Promise<
  | { success: true; options: SreDiagnosticQuerySetupOptions }
  | { success: false; error: string; options: SreDiagnosticQuerySetupOptions }
> {
  const emptyOptions = { connectors: [] };

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureDiagnosticQueries(userId, organizationId, project);

    const connectors = await db
      .select({ id: externalConnectors.id, name: externalConnectors.name, type: externalConnectors.type, status: externalConnectors.status })
      .from(externalConnectors)
      .where(and(eq(externalConnectors.organizationId, organizationId), eq(externalConnectors.projectId, project.id)))
      .orderBy(externalConnectors.name);

    return { success: true, options: { connectors } };
  } catch (error) {
    console.error("Error fetching SRE diagnostic query setup options:", error);
    return { success: false, error: "Failed to fetch diagnostic query setup options", options: emptyOptions };
  }
}

export async function createSreDiagnosticQuery(input: z.infer<typeof createDiagnosticQuerySchema>): Promise<SreDiagnosticQueryActionResult> {
  const parsed = createDiagnosticQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid diagnostic query definition", fieldErrors: formatValidationErrors(parsed.error) };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureDiagnosticQueries(userId, organizationId, project);

    const [connector] = await db
      .select({ id: externalConnectors.id, type: externalConnectors.type, status: externalConnectors.status })
      .from(externalConnectors)
      .where(and(eq(externalConnectors.id, parsed.data.connectorId), eq(externalConnectors.organizationId, organizationId), eq(externalConnectors.projectId, project.id)))
      .limit(1);

    if (!connector) {
      return { success: false, error: "Connector not found for this project" };
    }

    if (!isDiagnosticQueryTypeCompatible(connector.type, parsed.data.queryType)) {
      return {
        success: false,
        error: `${parsed.data.queryType} diagnostic queries are not supported for ${connector.type.replace(/_/g, " ")} connectors`,
      };
    }

    try {
      validateDiagnosticQueryParameterSchema(parsed.data.parameterSchema);
      validateTemplatePlaceholderCoverage(parsed.data.template, parsed.data.allowlist);
    } catch (validationError) {
      return { success: false, error: validationError instanceof Error ? validationError.message : "Invalid diagnostic query definition" };
    }

    const now = new Date();
    const [created] = await db
      .insert(diagnosticQueries)
      .values({
        organizationId,
        projectId: project.id,
        connectorId: connector.id,
        name: parsed.data.name,
        queryType: parsed.data.queryType,
        template: parsed.data.template,
        parameterSchema: parsed.data.parameterSchema,
        allowlist: parsed.data.allowlist,
        maxRows: parsed.data.maxRows,
        maxBytes: parsed.data.maxBytes,
        maxSeconds: parsed.data.maxSeconds,
        status: "active",
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_diagnostic_query_created",
      resource: "sre_connector",
      resourceId: created.id,
      metadata: {
        projectId: project.id,
        connectorId: connector.id,
        connectorType: connector.type,
        queryType: created.queryType,
        maxRows: created.maxRows,
        maxBytes: created.maxBytes,
        maxSeconds: created.maxSeconds,
      },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/runbooks");
    return {
      success: true,
      query: (await getDiagnosticQueryListItem(created.id, organizationId, project.id)) ?? undefined,
      message: "Diagnostic query created",
    };
  } catch (error) {
    console.error("Error creating SRE diagnostic query:", error);
    return { success: false, error: "Failed to create diagnostic query" };
  }
}

export async function disableSreDiagnosticQuery(input: z.infer<typeof disableDiagnosticQuerySchema>): Promise<SreDiagnosticQueryActionResult> {
  const parsed = disableDiagnosticQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid diagnostic query", fieldErrors: formatValidationErrors(parsed.error) };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureDiagnosticQueries(userId, organizationId, project);

    const [updated] = await db
      .update(diagnosticQueries)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(and(eq(diagnosticQueries.id, parsed.data.id), eq(diagnosticQueries.organizationId, organizationId), eq(diagnosticQueries.projectId, project.id)))
      .returning();

    if (!updated) {
      return { success: false, error: "Diagnostic query not found" };
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_diagnostic_query_disabled",
      resource: "sre_connector",
      resourceId: updated.id,
      metadata: { projectId: project.id, connectorId: updated.connectorId, queryType: updated.queryType },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/runbooks");
    return {
      success: true,
      query: (await getDiagnosticQueryListItem(updated.id, organizationId, project.id)) ?? undefined,
      message: "Diagnostic query disabled",
    };
  } catch (error) {
    console.error("Error disabling SRE diagnostic query:", error);
    return { success: false, error: "Failed to disable diagnostic query" };
  }
}
