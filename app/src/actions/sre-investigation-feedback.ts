"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  MAX_FEEDBACK_NOTE_LENGTH,
  submitInvestigationFeedback,
} from "@/lib/sre/investigation-feedback";
import { checkSreFeedbackRateLimit } from "@/lib/sre/sre-rate-limiter";

const logger = createLogger({ module: "sre-investigation-feedback" }) as {
  error: (data: unknown, message?: string) => void;
};

const feedbackSchema = z.object({
  investigationRunId: z.string().uuid(),
  hypothesisKey: z.string().regex(/^h[1-9]\d?$/).nullable().optional(),
  verdict: z.enum(["right", "wrong"]),
  note: z.string().max(MAX_FEEDBACK_NOTE_LENGTH * 2).nullable().optional(),
});

export type SreFeedbackActionResult =
  | { success: true }
  | { success: false; error: string };

/** Records Right/Wrong for an investigation or one hypothesis. Same RBAC as other incident updates. */
export async function submitSreInvestigationFeedback(
  input: z.input<typeof feedbackSchema>,
): Promise<SreFeedbackActionResult> {
  try {
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid feedback" };

    const { userId, organizationId, project } = await requireProjectContext();
    if (!checkPermissionWithContext("sre_incident", "update", { userId, organizationId, project })) {
      return { success: false, error: "Insufficient permissions to give feedback" };
    }

    const limit = await checkSreFeedbackRateLimit(userId, parsed.data.investigationRunId);
    if (!limit.allowed) {
      return {
        success: false,
        error: limit.unavailable
          ? "Feedback is temporarily unavailable. Try again shortly."
          : "Too much feedback in a short time. Try again in a few minutes.",
      };
    }

    const result = await submitInvestigationFeedback(
      { userId, organizationId, projectId: project.id },
      {
        investigationRunId: parsed.data.investigationRunId,
        hypothesisKey: parsed.data.hypothesisKey ?? null,
        verdict: parsed.data.verdict,
        note: parsed.data.note ?? null,
      },
    );
    if (!result.ok) return { success: false, error: result.error };
    revalidatePath("/incidents");
    return { success: true };
  } catch (error) {
    logger.error({ error }, "Error saving SRE investigation feedback");
    return { success: false, error: "Failed to save feedback" };
  }
}
