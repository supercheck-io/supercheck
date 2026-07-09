import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { streamEvidenceBrief } from "@/lib/sre/evidence-brief-generator";
import { runSreEvidenceBriefGeneration } from "@/lib/sre/evidence-brief-orchestrator";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreEvidenceBriefRateLimit } from "@/lib/sre/sre-rate-limiter";

const requestSchema = z.object({
  incidentId: z.string().uuid(),
});

const encoder = new TextEncoder();

function errorMessage(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (value instanceof Error && value.message) {
    return value.message;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }

  return fallback;
}

function encodeData(data: unknown) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof requestSchema>;

  try {
    parsed = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid incident ID" },
      { status: 400 },
    );
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
    return NextResponse.json(
      {
        success: false,
        error: "Insufficient permissions to investigate this incident",
      },
      { status: 403 },
    );
  }

  const rateLimit = await checkSreEvidenceBriefRateLimit(
    userId,
    parsed.incidentId,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: rateLimit.unavailable
          ? "Evidence brief rate limiter is temporarily unavailable. Try again shortly."
          : "Evidence brief generation rate limit reached. Wait a moment and try again.",
      },
      { status: rateLimit.unavailable ? 503 : 429 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encodeData(data));

      try {
        const result = await runSreEvidenceBriefGeneration({
          userId,
          organizationId,
          projectId: project.id,
          incidentId: parsed.incidentId,
          generateBrief: (input) =>
            streamEvidenceBrief(input, (chunk) => {
              send({ type: "content", content: chunk });
            }),
        });

        if (!result.success) {
          send({ type: "error", error: result.error });
          return;
        }

        revalidatePath("/incidents");
        revalidatePath(`/incidents/${parsed.incidentId}`);

        send({
          type: "done",
          message: result.message,
          evidenceCount: result.evidenceCount,
          connectorEvidenceCount: result.connectorEvidenceCount,
          investigationRunId: result.investigationRunId,
          brief: {
            suspectedFailureDomain: result.brief.suspectedFailureDomain,
            summary: result.brief.summary,
            confidenceScore: result.brief.confidenceScore,
            citedEvidenceIds: result.brief.citedEvidenceIds,
            provider: result.brief.provider,
          },
        });
      } catch (error) {
        console.error("Error streaming SRE evidence brief:", error);
        send({
          type: "error",
          error: errorMessage(error, "Failed to generate evidence brief"),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
