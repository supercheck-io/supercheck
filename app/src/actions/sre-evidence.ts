"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateEvidenceBrief } from "@/lib/sre/evidence-brief-generator";
import { runSreEvidenceBriefGeneration } from "@/lib/sre/evidence-brief-orchestrator";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreEvidenceBriefRateLimit } from "@/lib/sre/sre-rate-limiter";

const generateBriefSchema = z.object({
  incidentId: z.string().uuid(),
});

export type GenerateSreEvidenceBriefResult =
  | {
      success: true;
      message: string;
      brief: {
        suspectedFailureDomain: string;
        summary: string;
        confidenceScore: number;
        citedEvidenceIds: string[];
        provider: "ai" | "fallback";
      };
      evidenceCount: number;
    }
  | { success: false; error: string };

export async function generateSreEvidenceBrief(input: {
  incidentId: string;
}): Promise<GenerateSreEvidenceBriefResult> {
  try {
    const parsed = generateBriefSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid incident ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext(
      "sre_incident",
      "investigate",
      {
        userId,
        organizationId,
        project,
      },
    );

    if (!canInvestigate) {
      return {
        success: false,
        error: "Insufficient permissions to investigate this incident",
      };
    }

    const rateLimit = await checkSreEvidenceBriefRateLimit(
      userId,
      parsed.data.incidentId,
    );
    if (!rateLimit.allowed) {
      if (rateLimit.unavailable) {
        return {
          success: false,
          error:
            "Evidence brief rate limiter is temporarily unavailable. Try again shortly.",
        };
      }

      return {
        success: false,
        error:
          "Evidence brief generation rate limit reached. Wait a moment and try again.",
      };
    }

    const result = await runSreEvidenceBriefGeneration({
      userId,
      organizationId,
      projectId: project.id,
      incidentId: parsed.data.incidentId,
      generateBrief: generateEvidenceBrief,
    });

    if (!result.success) {
      return result;
    }

    revalidatePath("/incidents");
    revalidatePath(`/incidents/${parsed.data.incidentId}`);

    return {
      success: true,
      message: result.message,
      brief: {
        suspectedFailureDomain: result.brief.suspectedFailureDomain,
        summary: result.brief.summary,
        confidenceScore: result.brief.confidenceScore,
        citedEvidenceIds: result.brief.citedEvidenceIds,
        provider: result.brief.provider,
      },
      evidenceCount: result.evidenceCount,
    };
  } catch (error) {
    console.error("Error generating SRE evidence brief:", error);
    return {
      success: false,
      error: "Failed to generate native evidence brief",
    };
  }
}
