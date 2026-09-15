"use server";

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import {
  diagnosticQueries,
  externalConnectors,
  privateAgents,
  sreServices,
} from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-onboarding" }) as {
  error: (data: unknown, message?: string) => void;
};

export type SreOnboardingStatus = {
  services: number;
  connectors: number;
  diagnosticRecipes: number;
  privateAgents: number;
  completedRequiredSteps: number;
  requiredSteps: number;
  complete: boolean;
};

export async function getSreOnboardingStatus(): Promise<
  | { success: true; status: SreOnboardingStatus }
  | { success: false; error: string; status: null }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canViewServices = checkPermissionWithContext("sre_service", "view", {
      userId,
      organizationId,
      project,
    });
    const canViewConnectors = checkPermissionWithContext(
      "sre_connector",
      "view",
      {
        userId,
        organizationId,
        project,
      },
    );
    if (!canViewServices || !canViewConnectors) {
      return {
        success: false,
        error: "Insufficient permissions to view AI SRE setup",
        status: null,
      };
    }

    const [serviceRows, connectorRows, recipeRows, agentRows] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(${sreServices.id})::int` })
          .from(sreServices)
          .where(
            and(
              eq(sreServices.organizationId, organizationId),
              eq(sreServices.projectId, project.id),
              ne(sreServices.status, "merged"),
            ),
          ),
        db
          .select({ count: sql<number>`count(${externalConnectors.id})::int` })
          .from(externalConnectors)
          .where(
            and(
              eq(externalConnectors.organizationId, organizationId),
              eq(externalConnectors.projectId, project.id),
              inArray(externalConnectors.status, ["configured", "valid"]),
            ),
          ),
        db
          .select({ count: sql<number>`count(${diagnosticQueries.id})::int` })
          .from(diagnosticQueries)
          .where(
            and(
              eq(diagnosticQueries.organizationId, organizationId),
              eq(diagnosticQueries.projectId, project.id),
              eq(diagnosticQueries.status, "active"),
            ),
          ),
        db
          .select({ count: sql<number>`count(${privateAgents.id})::int` })
          .from(privateAgents)
          .where(
            and(
              eq(privateAgents.organizationId, organizationId),
              or(
                eq(privateAgents.projectId, project.id),
                isNull(privateAgents.projectId),
              ),
              ne(privateAgents.status, "disabled"),
            ),
          ),
      ]);

    const services = serviceRows[0]?.count ?? 0;
    const connectors = connectorRows[0]?.count ?? 0;
    const diagnosticRecipes = recipeRows[0]?.count ?? 0;
    const privateAgentCount = agentRows[0]?.count ?? 0;
    const completedRequiredSteps =
      Number(services > 0) +
      Number(connectors > 0) +
      Number(diagnosticRecipes > 0);

    return {
      success: true,
      status: {
        services,
        connectors,
        diagnosticRecipes,
        privateAgents: privateAgentCount,
        completedRequiredSteps,
        requiredSteps: 3,
        complete: completedRequiredSteps === 3,
      },
    };
  } catch (error) {
    logger.error({ error }, "Error fetching AI SRE setup status");
    return {
      success: false,
      error: "Failed to fetch AI SRE setup status",
      status: null,
    };
  }
}
