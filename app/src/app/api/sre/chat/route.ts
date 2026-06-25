import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";
import { checkSreChatRateLimit } from "@/lib/sre/sre-rate-limiter";
import { buildSreTriageSystemPrompt } from "@/sre/agents/triage";
import { runSreAgent } from "@/sre/lib/agent-runner";
import { createSreConversation, appendSreMessage, getSreConversation } from "@/sre/lib/session-store";
import { createSseResponse, createSseStream } from "@/sre/lib/sse-stream";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import { createSreEvidenceTools } from "@/sre/tools/evidence-tools";

const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  incidentId: z.string().uuid().optional().nullable(),
  message: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(200).optional().nullable(),
  attachments: z.array(z.union([
    z.object({
      type: z.literal("text"),
      title: z.string().trim().min(1).max(120),
      content: z.string().trim().min(1).max(2000),
    }),
    z.object({
      type: z.literal("file"),
      title: z.string().trim().min(1).max(120),
      fileName: z.string().trim().min(1).max(120),
      mimeType: z.string().trim().min(1).max(120),
      size: z.number().int().min(1).max(2 * 1024 * 1024),
      storageBucket: z.string().trim().min(1).max(120),
      storagePath: z.string().trim().min(1).max(1000),
      incidentId: z.string().uuid(),
    }),
  ])).max(3).optional().default([]),
});

const SRE_ATTACHMENTS_BUCKET = process.env.S3_SRE_ATTACHMENTS_BUCKET_NAME || "sre-chat-attachments";

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

type SreChatTextAttachment = z.infer<typeof chatRequestSchema>["attachments"][number];

function sanitizeAttachmentForPrompt(attachment: SreChatTextAttachment) {
  if (attachment.type === "file") {
    return {
      type: attachment.type,
      title: safeSummaryText(attachment.title, "File attachment", 120),
      fileName: safeSummaryText(attachment.fileName, "attachment", 120),
      mimeType: safeSummaryText(attachment.mimeType, "application/octet-stream", 120),
      size: attachment.size,
      storagePath: attachment.storagePath,
      note: "File bytes are stored securely; SRE AI receives metadata only and must not claim file contents were inspected unless provided in text evidence.",
    };
  }

  return {
    type: attachment.type,
    title: safeSummaryText(attachment.title, "Context attachment", 120),
    content: safeSummaryText(attachment.content, "Attachment content redacted or empty", 2000),
  };
}

function validateChatAttachments(input: {
  attachments: SreChatTextAttachment[];
  incidentId: string | null;
  projectId: string;
}) {
  return input.attachments.map((attachment) => {
    if (attachment.type === "text") {
      return sanitizeAttachmentForPrompt(attachment);
    }

    if (!input.incidentId || attachment.incidentId !== input.incidentId) {
      throw new Error("SRE chat file attachment does not belong to this incident");
    }

    const expectedPrefix = `projects/${input.projectId}/sre-chat/${input.incidentId}/`;
    if (attachment.storageBucket !== SRE_ATTACHMENTS_BUCKET || !attachment.storagePath.startsWith(expectedPrefix)) {
      throw new Error("Invalid SRE chat file attachment storage reference");
    }

    return sanitizeAttachmentForPrompt(attachment);
  });
}

function buildChatPrompt(input: {
  message: string;
  incidentId: string | null;
  projectName: string;
  attachments: Array<ReturnType<typeof sanitizeAttachmentForPrompt>>;
}) {
  return [
    `Project: ${input.projectName}`,
    input.incidentId ? `Incident ID: ${input.incidentId}` : "Incident ID: none",
    input.incidentId ? "Use available read-only evidence tools before giving incident-specific conclusions." : "No incident is scoped; do not claim incident evidence was inspected.",
    input.attachments.length > 0 ? `User-provided context attachments (server-validated metadata/text only):\n${JSON.stringify(input.attachments, null, 2)}` : null,
    "User request:",
    input.message,
    "Respond with read-only investigation guidance. If evidence is missing, state what should be gathered next.",
  ].filter(Boolean).join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeMetadataString(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(trimmed)) {
    return fallback;
  }

  return trimmed.slice(0, maxLength);
}

function safeSummaryText(value: unknown, fallback: string, maxLength = 140) {
  if (typeof value !== "string") {
    return fallback;
  }

  const redacted = value
    .replace(/([?&](?:token|api[_-]?key|access[_-]?token|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/\b(token|api[_-]?key|access[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;"']+/gi, "$1=[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();

  if (!redacted) {
    return fallback;
  }

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}

function summarizeToolResultPayload(payload: unknown) {
  const data = asRecord(payload);
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];
  const connectors = Array.isArray(data.connectors) ? data.connectors : [];
  const privateAgentJobId = typeof data.privateAgentJobId === "string" ? safeMetadataString(data.privateAgentJobId, "private-agent-job", 80) : null;
  const message = typeof data.message === "string" ? safeSummaryText(data.message, "Tool completed") : null;

  return {
    itemCount: evidence.length || connectors.length || (privateAgentJobId ? 1 : 0),
    message,
    privateAgentJobId,
    evidence: evidence.slice(0, 3).map((item) => {
      const record = asRecord(item);
      return {
        id: safeMetadataString(record.id, "evidence", 120),
        title: safeSummaryText(record.title, "Untitled evidence"),
        evidenceType: safeMetadataString(record.evidenceType, "evidence", 40),
        sourceType: safeMetadataString(record.sourceType, "source", 40),
      };
    }),
    connectors: connectors.slice(0, 3).map((item) => {
      const record = asRecord(item);
      return {
        id: safeMetadataString(record.id, "connector", 120),
        name: safeSummaryText(record.name, "Connector", 100),
        type: safeMetadataString(record.type, "connector", 40),
        executionMode: safeMetadataString(record.executionMode, "read-only", 40),
      };
    }),
  };
}

function sanitizeSreAgentStepEvent(value: unknown) {
  const step = asRecord(value);
  const event = asRecord(step.event);
  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];

  return {
    modelId: safeMetadataString(step.modelId, "unknown-model", 100),
    stepIndex: typeof step.stepIndex === "number" ? step.stepIndex : null,
    elapsedMs: typeof step.elapsedMs === "number" ? step.elapsedMs : null,
    event: {
      toolCalls: toolCalls.slice(0, 10).map((toolCall, index) => {
        const record = asRecord(toolCall);
        return {
          toolCallId: safeMetadataString(record.toolCallId, `tool-call-${index}`),
          toolName: safeMetadataString(record.toolName ?? record.name, "read-only-tool", 80),
        };
      }),
      toolResults: toolResults.slice(0, 10).map((toolResult, index) => {
        const record = asRecord(toolResult);
        return {
          toolCallId: safeMetadataString(record.toolCallId, `tool-call-${index}`),
          summary: summarizeToolResultPayload(record.result ?? record.output),
        };
      }),
    },
  };
}

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requireProjectContext>>;
  try {
    context = await requireProjectContext();
  } catch (error) {
    return authErrorResponse(error);
  }

  const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  });
  const canInvestigateConnectors = checkPermissionWithContext("sre_connector", "investigate", {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  });

  if (!canInvestigate) {
    return NextResponse.json({ error: "Insufficient permissions to use SRE AI" }, { status: 403 });
  }

  const rateLimit = await checkSreChatRateLimit(context.userId);
  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.resetTime ? Math.ceil((rateLimit.resetTime - Date.now()) / 1000) : 60;
    return NextResponse.json(
      { error: "SRE AI chat rate limit reached. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid SRE chat request" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid SRE chat request" }, { status: 400 });
  }

  const stream = createSseStream(async (send) => {
    const conversation = parsed.data.conversationId
      ? await getSreConversation({
          organizationId: context.organizationId,
          projectId: context.project.id,
          userId: context.userId,
          conversationId: parsed.data.conversationId,
        })
      : await createSreConversation({
          organizationId: context.organizationId,
          projectId: context.project.id,
          userId: context.userId,
          incidentId: parsed.data.incidentId ?? null,
          title: parsed.data.title ?? parsed.data.message.slice(0, 80),
          scope: {
            source: "sre_chat_api",
            incidentId: parsed.data.incidentId ?? null,
          },
        });

    send("conversation", {
      id: conversation.id,
      incidentId: conversation.incidentId,
      status: conversation.status,
    });

    const sanitizedAttachments = validateChatAttachments({
      attachments: parsed.data.attachments,
      incidentId: conversation.incidentId,
      projectId: context.project.id,
    });

    const userMessage = await appendSreMessage({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      conversationId: conversation.id,
      role: "user",
      content: parsed.data.message,
      attachments: sanitizedAttachments,
    });
    send("message", { id: userMessage.id, role: userMessage.role });

    let assistantText: string;
    let modelId: string | null = null;
    try {
      const incidentToolScope = conversation.incidentId
        ? {
            organizationId: context.organizationId,
            projectId: context.project.id,
            incidentId: conversation.incidentId,
            userId: context.userId,
          }
        : null;
      const result = await runSreAgent({
        system: buildSreTriageSystemPrompt(),
        prompt: buildChatPrompt({
          message: parsed.data.message,
          incidentId: conversation.incidentId,
          projectName: context.project.name,
          attachments: sanitizedAttachments,
        }),
        tools: incidentToolScope
          ? {
              ...createSreEvidenceTools(incidentToolScope),
              ...(canInvestigateConnectors ? createSreConnectorTools(incidentToolScope) : {}),
            }
          : undefined,
        budget: { maxSteps: 4, maxOutputTokens: 1200, timeoutMs: 45_000 },
        onStepFinish: (event) => send("agent.step", sanitizeSreAgentStepEvent(event)),
      });
      assistantText = result.text;
      modelId = result.modelId;
    } catch (error) {
      console.error("SRE agent error:", error);
      assistantText = "SRE AI is temporarily unavailable. The conversation was saved; gather native evidence or connector evidence and retry.";
      send("agent.fallback", {
        reason: "ai_unavailable",
      });
    }

    const assistantMessage = await appendSreMessage({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      conversationId: conversation.id,
      role: "assistant",
      content: assistantText,
      modelId,
    });

    send("message", {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantText,
      modelId,
    });
  });

  return createSseResponse(stream);
}
