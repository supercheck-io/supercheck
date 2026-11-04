import { readCappedJson } from "@/lib/http/read-capped-json";
import { isSreEnabled } from "@/sre/lib/feature-gates";
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
import { recordSreTokenUsage, sreDailyTokenLimitResponse } from "@/lib/sre/sre-daily-token-limit";
import { checkSreChatRateLimit } from "@/lib/sre/sre-rate-limiter";
import { buildSreTriageSystemPrompt } from "@/sre/agents/triage";
import {
  assertSreAgentPromptWithinBudget,
  keepNewestWithinBudget,
  resolveSreAgentBudget,
} from "@/sre/lib/budget-manager";
import {
  appendSreMessage,
  createSreConversation,
  getSreConversation,
  listSreMessages,
  listSreMessagesByIds,
    SRE_MESSAGE_INTERRUPTED,
  SreSessionStoreError,
  isSreMessageSuperseded,
} from "@/sre/lib/session-store";
import { SRE_CHART_PROMPT_LINES } from "@/sre/lib/chart-contract";
import { createSreConnectorTools } from "@/sre/tools/connector-tools";
import { createSreSimilarIncidentTools } from "@/sre/tools/similar-incident-tools";
import { createSreEvidenceTools } from "@/sre/tools/evidence-tools";
import { requireSreSameOriginRequest, requireSreSubscription } from "../../_auth";

type SreAssistantUiMessageMetadata = {
  conversationId?: string;
  assistantMessageId?: string;
  modelId?: string;
  interrupted?: boolean;
};

type SreAssistantUiMessage = UIMessage<SreAssistantUiMessageMetadata>;

// Only the newest user turn is capped at this; older turns are trimmed by fitPromptHistory.
const MAX_MESSAGE_TEXT_LENGTH = 4000;
// Transport safety bounds, not product limits: the prompt budget decides how much history is used.
const MAX_PART_TEXT_LENGTH = 100_000;
const MAX_REQUEST_MESSAGES = 1000;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
// Stored replies the request may claim; keeps the verification lookup bounded by the newest turns.
const MAX_VERIFIED_ASSISTANT_IDS = 200;
const HISTORY_ROW_LIMIT = 200;
const logger = createLogger({ module: "sre-assistant-ui" }) as {
  error: (data: unknown, message?: string) => void;
};

const assistantUiPartSchema = z
  .object({
    type: z.string().trim().min(1).max(80),
    text: z.string().max(MAX_PART_TEXT_LENGTH).optional(),
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
  useLiveConnectorTools: z.boolean().optional().default(true),
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .optional()
    .default("submit-message"),
  messageId: z.string().trim().min(1).max(200).optional(),
  messages: z.array(assistantUiMessageSchema).min(1).max(MAX_REQUEST_MESSAGES),
});

function authErrorResponse(error: unknown) {
  void error; // never echo the underlying error to the client
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
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

/**
 * The newest turns that fit the budget, always ending with the latest user turn
 * and starting on a user turn, as providers expect.
 */
function fitPromptHistory(messages: SreAssistantUiMessage[], maxChars: number) {
  let lastUser = messages.length - 1;
  while (lastUser > 0 && messages[lastUser]?.role !== "user") lastUser -= 1;
  const trailing = messages.slice(lastUser + 1);
  const trailingChars = trailing.reduce((total, message) => total + getTextFromUiMessage(message).length, 0);
  const kept = keepNewestWithinBudget(
    messages.slice(0, lastUser + 1),
    (message) => getTextFromUiMessage(message).length,
    maxChars - trailingChars,
  );
  while (kept.length > 1 && kept[0]?.role !== "user") kept.shift();
  return [...kept, ...trailing];
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
      : "General Copilot chat rules:",
    `- Project: ${input.projectName}`,
    input.incidentId ? `- Scoped incident ID: ${input.incidentId}` : null,
    "- This chat is read-only. Do not suggest production mutations or destructive commands.",
    input.incidentId
      ? "- Use available stored evidence tools before making incident-specific claims. Cite the evidence ids you rely on, written as evidence <id>. For \"have we seen this before\" questions call findSimilarIncidents and say that past incidents may be unrelated."
      : "- If no incident is scoped, do not claim incident evidence was inspected.",
    !input.liveConnectorToolsEnabled
      ? "- Live connector tools are not available for this chat; explain that verification is based on stored evidence and user-provided context only."
      : null,
    input.liveConnectorToolsEnabled
      ? "- Use available live connector tools when fresh data is needed. For a general question, discover project connectors and service IDs first; ask which service if the target is ambiguous. Never claim a source was checked without successful tool output."
      : null,
    "- Never invent evidence IDs, source systems, queries, observations, metric values, timestamps, or confidence levels.",
    "- Treat evidence as verified only when it appears in tool output or was explicitly supplied by the user. Otherwise say that no supporting evidence is available.",
    "- Prefer concise headings, short bullets, markdown tables for comparisons, and fenced code blocks for commands or queries.",
    "- Answer the user's exact question first. Keep a simple health question concise when no evidence is available.",
    "- Never invent or assign team names, owners, departments, escalation paths, or handoff tasks unless the user explicitly asks for ownership planning and supplies that organization context.",
    "- Do not pad an answer with a generic multi-team checklist. Suggest only the smallest useful next action or bounded read-only check.",
    "- Do not ask vaguely for more context. State exactly which evidence boundary applies and the single most useful way to continue in Supercheck.",
    "- Do not emit raw markdown heading markers as decoration; use headings only when they add structure.",
    "- When evidence is missing, name the gap and suggest the next read-only checks. Do not present a generic checklist as completed verification.",
    ...SRE_CHART_PROMPT_LINES.map((line, index) => (index === 1 ? line : `- ${line}`)),
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

  if (!isSreEnabled()) {
    return NextResponse.json(
      {
        error: "AI SRE is disabled",
        code: "feature_disabled",
        enabledBy: "SRE_ENABLED",
      },
      { status: 503 },
    );
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

  const subscriptionError = await requireSreSubscription(context.organizationId, { allowTrial: false });
  if (subscriptionError) return subscriptionError;

  const dailyLimitResponse = await sreDailyTokenLimitResponse(context.organizationId);
  if (dailyLimitResponse) return dailyLimitResponse;

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

  // Long chats are allowed, but the whole body stays bounded before it is parsed.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: "Copilot chat history is too large" }, { status: 413 });
  }

  // Stream-capped by bytes: covers chunked bodies and multi-byte text that a character count misses.
  const read = await readCappedJson(request, MAX_REQUEST_BODY_BYTES);
  if (read.tooLarge) {
    return NextResponse.json({ error: "Copilot chat history is too large" }, { status: 413 });
  }
  const parsedBody = read.data;
  const parsed = assistantUiChatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Copilot chat request" },
      { status: 400 },
    );
  }

  const messages = parsed.data.messages.map(normalizeAssistantUiMessage);
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
  if (latestUserText.length > MAX_MESSAGE_TEXT_LENGTH) {
    return NextResponse.json({ error: "Copilot message is too large" }, { status: 413 });
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

  if (conversation && conversation.status !== "active") {
    return NextResponse.json({ error: "This chat was archived" }, { status: 409 });
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

  // Checked before anything is saved, so a rejected message leaves no orphan turn.
  const budget = resolveSreAgentBudget({
    maxSteps: 4,
    maxOutputTokens: 1200,
    timeoutMs: 45_000,
  });
  const liveConnectorToolsEnabled =
    parsed.data.useLiveConnectorTools && canInvestigateConnectors;
  const system = buildAssistantUiSystemPrompt({
    projectName: context.project.name,
    incidentId: requestedIncidentId,
    liveConnectorToolsEnabled,
  });
  try {
    assertSreAgentPromptWithinBudget(`${system}\n\n${latestUserText}`, budget);
  } catch {
    return NextResponse.json(
      { error: "Copilot message is too large" },
      { status: 413 },
    );
  }
  // Client-sent history is only a claim. User turns are the caller's own words (their
  // client ids are not storable), but an assistant turn counts only when a stored row in
  // THIS conversation has the same id, role and text, so a forged reply is dropped.
  const regenerating = parsed.data.trigger === "regenerate-message";
  const regenerateTargetId = parsed.data.messageId;
  if (regenerating && !regenerateTargetId) {
    // The SDK trims the reply from `messages`, so nothing sent can name it; only an old cached client omits the id.
    return NextResponse.json(
      { error: "Reload the chat and try again" },
      { status: 400 },
    );
  }
  const newestUserIndex = messages.lastIndexOf(latestUserMessage);
  let claimed = messages.slice(0, newestUserIndex);
  if (regenerating) {
    const targetIndex = messages.findIndex((message) => message.id === regenerateTargetId);
    claimed = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
  }
  const scope = {
    organizationId: context.organizationId,
    projectId: context.project.id,
    userId: context.userId,
  };
  const isInterrupted = (row: { attachments: Record<string, unknown>[] | null }) =>
    Boolean(row.attachments?.some((item) => item.type === SRE_MESSAGE_INTERRUPTED));
  const toUiMessage = (row: { id: string; role: string; content: string | null }) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: row.content ?? "" }],
  });
  let history: SreAssistantUiMessage[] = [];
  if (conversation) {
    try {
      const assistantIds = [
        ...new Set(
          claimed
            .filter((message) => message.role === "assistant" && z.string().uuid().safeParse(message.id).success)
            .map((message) => message.id),
        ),
      ].slice(-MAX_VERIFIED_ASSISTANT_IDS);
      const lookupIds = regenerating && regenerateTargetId && z.string().uuid().safeParse(regenerateTargetId).success
        ? [...assistantIds, regenerateTargetId]
        : assistantIds;
      const stored = new Map(
        (await listSreMessagesByIds({ ...scope, conversationId: conversation.id, messageIds: lookupIds })).map(
          (row) => [row.id, row],
        ),
      );
      if (regenerating) {
        const target = regenerateTargetId ? stored.get(regenerateTargetId) : undefined;
        if (target?.role !== "assistant" || isSreMessageSuperseded(target)) {
          return NextResponse.json(
            { error: "Copilot message to regenerate was not found" },
            { status: 400 },
          );
        }
      }
      const verified = claimed.filter((message) => {
        if (message.role === "user") return true;
        const row = stored.get(message.id);
        return (
          row?.role === "assistant" &&
          !isInterrupted(row) &&
          !isSreMessageSuperseded(row) &&
          row.content?.trim() === getTextFromUiMessage(message)
        );
      });
      const hadAssistantTurns = claimed.some((message) => message.role === "assistant");
      const verifiedAssistantTurns = verified.some((message) => message.role === "assistant");
      if (!regenerating && hadAssistantTurns && !verifiedAssistantTurns) {
        // Conversations from before reply ids were stored: rebuild from the newest stored rows.
        const rows = await listSreMessages({
          ...scope,
          conversationId: conversation.id,
          limit: HISTORY_ROW_LIMIT,
        });
        history = rows
          .filter((row) => (row.role === "user" || row.role === "assistant") && row.content?.trim() && !isInterrupted(row) && !isSreMessageSuperseded(row))
          .map(toUiMessage);
      } else {
        history = verified.filter((message) => getTextFromUiMessage(message));
      }
    } catch (error) {
      logger.error({ error }, "Failed to load Copilot conversation history");
      return NextResponse.json(
        { error: "Copilot conversation could not be loaded" },
        { status: 500 },
      );
    }
  } else if (regenerating) {
    return NextResponse.json(
      { error: "Copilot message to regenerate was not found" },
      { status: 400 },
    );
  } else {
    history = claimed.filter((message) => message.role === "user" && getTextFromUiMessage(message));
  }
  if (regenerating) {
    if (!history.some((message) => message.role === "user")) {
      return NextResponse.json(
        { error: "Copilot message to regenerate was not found" },
        { status: 400 },
      );
    }
  } else {
    history = [
      ...history,
      { id: latestUserMessage.id, role: "user", parts: [{ type: "text", text: latestUserText }] },
    ];
  }
  const promptMessages = fitPromptHistory(
    history,
    budget.maxPromptChars - system.length,
  );

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
    try {
      await appendSreMessage({
        organizationId: context.organizationId,
        projectId: context.project.id,
        userId: context.userId,
        conversationId: conversation.id,
        role: "user",
        content: latestUserText,
        attachments: [],
      });
    } catch (error) {
      // The conversation was archived or removed after it was loaded.
      if (error instanceof SreSessionStoreError && error.code === "not_found") {
        return NextResponse.json({ error: "This chat was archived" }, { status: 409 });
      }
      logger.error({ error }, "Failed to store Copilot message");
      return NextResponse.json({ error: "Copilot conversation could not be updated" }, { status: 500 });
    }
  }

  const connectorToolScope = {
    organizationId: context.organizationId,
    projectId: context.project.id,
    incidentId: conversation.incidentId,
    userId: context.userId,
  };

  const modelId = getActualModelName();
  const activeConversationId = conversation.id;
  const assistantMessageId = randomUUID();
  const result = streamText({
    model: getProviderModel(),
    system,
    messages: await convertToModelMessages(promptMessages),
    tools: {
      ...(conversation.incidentId
        ? {
            ...createSreEvidenceTools({
              ...connectorToolScope,
              incidentId: conversation.incidentId,
            }),
            ...createSreSimilarIncidentTools({
              organizationId: context.organizationId,
              projectId: context.project.id,
              incidentId: conversation.incidentId,
            }),
          }
        : {}),
      ...(liveConnectorToolsEnabled
        ? createSreConnectorTools(connectorToolScope)
        : {}),
    },
    stopWhen: stepCountIs(budget.maxSteps),
    maxOutputTokens: budget.maxOutputTokens,
    onStepFinish: (event) => recordSreTokenUsage(context.organizationId, event.usage),
    // Stop the model when the client disconnects, not only on the time budget.
    abortSignal: AbortSignal.any([
      AbortSignal.timeout(budget.timeoutMs),
      request.signal,
    ]),
  });

  return result.toUIMessageStreamResponse<SreAssistantUiMessage>({
    originalMessages: messages,
    // The streamed reply carries the id it is stored under, so a later regenerate can name it.
    generateMessageId: () => assistantMessageId,
    messageMetadata: ({ part }) => {
      // The server ended the reply (time budget or abort); tell the live view, which sees no Stop.
      if (part.type === "abort") {
        return { conversationId: activeConversationId, modelId, interrupted: true };
      }
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
    onFinish: async ({ responseMessage, isAborted, outcome }) => {
      // On a client disconnect onFinish can run from cancel() with isAborted false, so check the outcome too.
      if (isAborted || outcome?.status === "aborted") {
        const partial = getTextFromUiMessage(responseMessage);
        try {
          await appendSreMessage({
            id: assistantMessageId,
            organizationId: context.organizationId,
            projectId: context.project.id,
            userId: context.userId,
            conversationId: activeConversationId,
            role: "assistant",
            content: partial || "This reply was interrupted before it finished.",
            attachments: [{ type: SRE_MESSAGE_INTERRUPTED }],
            modelId,
          });
        } catch (error) {
          logger.error({ error }, "Failed to store interrupted Copilot reply");
        }
        return;
      }

      const assistantText =
        getTextFromUiMessage(responseMessage) ||
        "Copilot could not complete the read-only check. No failed connector result was treated as evidence.";

      try {
        await appendSreMessage(
          {
            id: assistantMessageId,
            organizationId: context.organizationId,
            projectId: context.project.id,
            userId: context.userId,
            conversationId: activeConversationId,
            role: "assistant",
            content: assistantText,
            modelId,
          },
          ...(regenerating && regenerateTargetId ? [{ supersedeMessageId: regenerateTargetId }] : []),
        );
      } catch (error) {
        // The reply already streamed; a failed save (for example an archive mid-stream) must not throw out of the stream.
        logger.error({ error }, "Failed to store Copilot reply");
      }
    },
  });
}
