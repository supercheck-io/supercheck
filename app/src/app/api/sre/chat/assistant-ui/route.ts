import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getActualModelName,
  getProviderModel,
  validateAIConfiguration,
} from "@/lib/ai/ai-provider";
import { requireProjectContext } from "@/lib/project-context";
import { createLogger } from "@/lib/logger/index";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreChatRateLimit } from "@/lib/sre/sre-rate-limiter";
import { buildSreTriageSystemPrompt } from "@/sre/agents/triage";
import {
  assertSreAgentPromptWithinBudget,
  resolveSreAgentBudget,
} from "@/sre/lib/budget-manager";
import {
  appendSreMessage,
  createSreConversation,
  getSreConversation,
  SreSessionStoreError,
} from "@/sre/lib/session-store";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import { createSreEvidenceTools } from "@/sre/tools/evidence-tools";
import { requireSreSameOriginRequest } from "../../_auth";

type SreAssistantUiMessageMetadata = {
  conversationId?: string;
  assistantMessageId?: string;
  modelId?: string;
};

type SreAssistantUiMessage = UIMessage<SreAssistantUiMessageMetadata>;

const MAX_MESSAGE_TEXT_LENGTH = 4000;
const MAX_TOTAL_MESSAGE_TEXT_LENGTH = 20_000;
const logger = createLogger({ module: "sre-assistant-ui" }) as {
  error: (data: unknown, message?: string) => void;
};

const assistantUiPartSchema = z
  .object({
    type: z.string().trim().min(1).max(80),
    text: z.string().max(MAX_MESSAGE_TEXT_LENGTH).optional(),
  })
  .passthrough();

const assistantUiMessageMetadataSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    assistantMessageId: z.string().uuid().optional(),
    modelId: z.string().trim().max(120).optional(),
  })
  .passthrough();

const assistantUiMessageSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    role: z.enum(["user", "assistant"]),
    metadata: assistantUiMessageMetadataSchema.optional(),
    parts: z.array(assistantUiPartSchema).max(50).optional(),
    content: z.array(assistantUiPartSchema).max(50).optional(),
  })
  .passthrough()
  .superRefine((message, context) => {
    const parts = message.parts ?? message.content ?? [];
    const hasTextPart = parts.some(
      (part) => part.type === "text" && typeof part.text === "string",
    );

    if (message.role === "user" && !hasTextPart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Message text parts are required",
        path: ["parts"],
      });
    }
  });

type ParsedAssistantUiMessage = z.infer<typeof assistantUiMessageSchema>;

const assistantUiChatRequestSchema = z.object({
  id: z.string().trim().max(200).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  incidentId: z.string().uuid().optional().nullable(),
  useLiveConnectorTools: z.boolean().optional().default(false),
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .optional()
    .default("submit-message"),
  messageId: z.string().trim().min(1).max(200).optional(),
  messages: z.array(assistantUiMessageSchema).min(1).max(50),
});

function authErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function getTextFromUiMessage(message: SreAssistantUiMessage) {
  return message.parts
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n")
    .trim();
}

function getLatestUserMessage(messages: SreAssistantUiMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message;
    }
  }

  return null;
}

function normalizeAssistantUiMessage(
  message: ParsedAssistantUiMessage,
): SreAssistantUiMessage {
  const parts = (message.parts ?? message.content ?? []).flatMap((part) =>
    part.type === "text" && typeof part.text === "string"
      ? [{ ...part, type: "text" as const, text: part.text }]
      : [],
  );
  const { content: _content, parts: _parts, ...rest } = message;

  return {
    ...rest,
    id: message.id ?? crypto.randomUUID(),
    parts,
  };
}

function getTotalMessageTextLength(messages: SreAssistantUiMessage[]) {
  return messages.reduce(
    (total, message) => total + getTextFromUiMessage(message).length,
    0,
  );
}

function buildAssistantUiSystemPrompt(input: {
  projectName: string;
  incidentId: string | null;
  liveConnectorToolsEnabled: boolean;
}) {
  return [
    buildSreTriageSystemPrompt(),
    "",
    input.incidentId
      ? "Incident-scoped Copilot chat rules:"
      : "Standalone Copilot chat rules:",
    `- Project: ${input.projectName}`,
    input.incidentId ? `- Scoped incident ID: ${input.incidentId}` : null,
    "- This chat is read-only. Do not suggest production mutations or destructive commands.",
    input.incidentId
      ? "- Use available stored evidence tools before making incident-specific claims. Use live connector tools only when the user enabled them and fresh evidence is needed."
      : "- If no incident is scoped, do not claim incident evidence was inspected.",
    input.incidentId && !input.liveConnectorToolsEnabled
      ? "- Live connector tools are not available for this chat; explain that verification is based on stored evidence and user-provided context only."
      : null,
    "- Never invent evidence IDs, source systems, queries, observations, metric values, timestamps, or confidence levels.",
    "- Treat evidence as verified only when it appears in tool output or was explicitly supplied by the user. Otherwise say that no supporting evidence is available.",
    !input.incidentId
      ? "- Standalone chat has no incident evidence or live connector scope. Ask for concrete symptoms or pasted evidence when the request lacks enough context."
      : null,
    "- Prefer concise headings, short bullets, markdown tables for comparisons, and fenced code blocks for commands or queries.",
    "- Answer the user's exact question first. Keep a simple health question concise when no evidence is available.",
    "- Never invent or assign team names, owners, departments, escalation paths, or handoff tasks unless the user explicitly asks for ownership planning and supplies that organization context.",
    "- Do not pad an answer with a generic multi-team checklist. Suggest only the smallest useful next action or bounded read-only check.",
    "- Do not ask vaguely for more context. State exactly which evidence boundary applies and the single most useful way to continue in Supercheck.",
    "- Do not emit raw markdown heading markers as decoration; use headings only when they add structure.",
    "- When evidence is missing, name the gap and suggest the next read-only checks. Do not present a generic checklist as completed verification.",
    "- When a small numeric summary is clearer as a chart and real values are available, include a fenced `chart` JSON block:",
    '{"type":"line","title":"Short title","description":"Optional one-sentence context","sources":[{"label":"Prometheus","type":"prometheus","evidenceIds":["ev-123"],"query":"rate(http_requests_total[5m])"}],"xKey":"label","series":[{"key":"value","label":"Value"}],"data":[{"label":"api","value":12}]}',
    "- Supported chart types are bar, line, and area. Use only evidence or values from the conversation; do not fabricate chart data.",
    "- Include chart sources when values come from evidence, connectors, or user-provided data. Source labels must be non-secret names such as Prometheus, Grafana, Kubernetes, or Generated preview data.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: NextRequest) {
  const sameOriginError = requireSreSameOriginRequest(request);
  if (sameOriginError) {
    return sameOriginError;
  }

  let context: Awaited<ReturnType<typeof requireProjectContext>>;
  try {
    context = await requireProjectContext();
  } catch (error) {
    return authErrorResponse(error);
  }

  const canInvestigate = checkPermissionWithContext(
    "sre_investigation",
    "investigate",
    {
      userId: context.userId,
      organizationId: context.organizationId,
      project: context.project,
    },
  );
  const canInvestigateConnectors = checkPermissionWithContext(
    "sre_connector",
    "investigate",
    {
      userId: context.userId,
      organizationId: context.organizationId,
      project: context.project,
    },
  );

  if (!canInvestigate) {
    return NextResponse.json(
      { error: "Insufficient permissions to use Copilot" },
      { status: 403 },
    );
  }

  const rateLimit = await checkSreChatRateLimit(context.userId);
  if (!rateLimit.allowed) {
    if (rateLimit.unavailable) {
      return NextResponse.json(
        {
          error:
            "Copilot chat rate limiter is temporarily unavailable. Please try again shortly.",
        },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }

    const retryAfter = rateLimit.resetTime
      ? Math.ceil((rateLimit.resetTime - Date.now()) / 1000)
      : 60;
    return NextResponse.json(
      {
        error:
          "Copilot chat rate limit reached. Please wait a moment and try again.",
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid Copilot chat request" },
      { status: 400 },
    );
  }

  const parsed = assistantUiChatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Copilot chat request" },
      { status: 400 },
    );
  }

  const messages = parsed.data.messages.map(normalizeAssistantUiMessage);
  const modelMessages = messages.filter(
    (message) =>
      message.role === "user" || Boolean(getTextFromUiMessage(message)),
  );
  if (getTotalMessageTextLength(messages) > MAX_TOTAL_MESSAGE_TEXT_LENGTH) {
    return NextResponse.json(
      { error: "Copilot chat history is too large" },
      { status: 413 },
    );
  }

  const latestUserMessage = getLatestUserMessage(messages);
  const latestUserText = latestUserMessage
    ? getTextFromUiMessage(latestUserMessage)
    : "";
  if (!latestUserMessage || !latestUserText) {
    return NextResponse.json(
      { error: "Copilot chat message is required" },
      { status: 400 },
    );
  }

  try {
    validateAIConfiguration();
  } catch {
    return NextResponse.json(
      { error: "Copilot is not configured" },
      { status: 503 },
    );
  }

  const requestedIncidentId = parsed.data.incidentId ?? null;
  let conversation: Awaited<ReturnType<typeof getSreConversation>> | null;
  try {
    conversation = parsed.data.conversationId
      ? await getSreConversation({
          organizationId: context.organizationId,
          projectId: context.project.id,
          userId: context.userId,
          conversationId: parsed.data.conversationId,
        })
      : null;
  } catch (error) {
    if (error instanceof SreSessionStoreError) {
      return NextResponse.json(
        { error: "Copilot conversation was not found" },
        { status: 404 },
      );
    }

    logger.error({ error }, "Failed to load Copilot conversation");
    return NextResponse.json(
      { error: "Copilot conversation could not be loaded" },
      { status: 500 },
    );
  }

  if (conversation && conversation.incidentId !== requestedIncidentId) {
    return NextResponse.json(
      {
        error:
          "Copilot conversation context changed. Start a new chat for this incident.",
      },
      { status: 409 },
    );
  }

  if (!conversation) {
    try {
      conversation = await createSreConversation({
        organizationId: context.organizationId,
        projectId: context.project.id,
        userId: context.userId,
        incidentId: requestedIncidentId,
        title: latestUserText.slice(0, 80),
        scope: {
          source: "sre_assistant_ui_chat_api",
          incidentId: requestedIncidentId,
        },
      });
    } catch (error) {
      if (error instanceof SreSessionStoreError) {
        return NextResponse.json(
          { error: "Incident not found or access denied" },
          { status: error.code === "incident_not_found" ? 404 : 400 },
        );
      }

      logger.error({ error }, "Failed to create Copilot conversation");
      return NextResponse.json(
        { error: "Copilot conversation could not be created" },
        { status: 500 },
      );
    }
  }

  if (parsed.data.trigger === "submit-message") {
    await appendSreMessage({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      conversationId: conversation.id,
      role: "user",
      content: latestUserText,
      attachments: [],
    });
  }

  const budget = resolveSreAgentBudget({
    maxSteps: 4,
    maxOutputTokens: 1200,
    timeoutMs: 45_000,
  });
  const incidentToolScope = conversation.incidentId
    ? {
        organizationId: context.organizationId,
        projectId: context.project.id,
        incidentId: conversation.incidentId,
        userId: context.userId,
      }
    : null;
  const liveConnectorToolsEnabled =
    Boolean(incidentToolScope) &&
    parsed.data.useLiveConnectorTools &&
    canInvestigateConnectors;
  const system = buildAssistantUiSystemPrompt({
    projectName: context.project.name,
    incidentId: conversation.incidentId,
    liveConnectorToolsEnabled,
  });
  const promptPreview = `${system}\n\n${latestUserText}`;
  assertSreAgentPromptWithinBudget(promptPreview, budget);

  const modelId = getActualModelName();
  const activeConversationId = conversation.id;
  const assistantMessageId = randomUUID();

  const result = streamText({
    model: getProviderModel(),
    system,
    messages: await convertToModelMessages(modelMessages),
    tools: incidentToolScope
      ? {
          ...createSreEvidenceTools(incidentToolScope),
          ...(liveConnectorToolsEnabled
            ? createSreConnectorTools(incidentToolScope)
            : {}),
        }
      : undefined,
    stopWhen: stepCountIs(budget.maxSteps),
    maxOutputTokens: budget.maxOutputTokens,
    abortSignal: AbortSignal.timeout(budget.timeoutMs),
  });

  return result.toUIMessageStreamResponse<SreAssistantUiMessage>({
    originalMessages: messages,
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") {
        return {
          conversationId: activeConversationId,
          modelId,
        };
      }

      return {
        conversationId: activeConversationId,
        assistantMessageId,
        modelId,
      };
    },
    onError: () =>
      "Copilot could not complete the read-only check. No failed connector result was treated as evidence.",
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) {
        return;
      }

      const assistantText =
        getTextFromUiMessage(responseMessage) ||
        "Copilot could not complete the read-only check. No failed connector result was treated as evidence.";

      await appendSreMessage({
        id: assistantMessageId,
        organizationId: context.organizationId,
        projectId: context.project.id,
        userId: context.userId,
        conversationId: activeConversationId,
        role: "assistant",
        content: assistantText,
        modelId,
      });
    },
  });
}
