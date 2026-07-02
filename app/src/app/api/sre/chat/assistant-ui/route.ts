import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getActualModelName, getProviderModel, validateAIConfiguration } from "@/lib/ai/ai-provider";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreChatRateLimit } from "@/lib/sre/sre-rate-limiter";
import { buildSreTriageSystemPrompt } from "@/sre/agents/triage";
import { assertSreAgentPromptWithinBudget, resolveSreAgentBudget } from "@/sre/lib/budget-manager";
import { appendSreMessage, createSreConversation, getSreConversation } from "@/sre/lib/session-store";

type SreAssistantUiMessageMetadata = {
  conversationId?: string;
  assistantMessageId?: string;
  modelId?: string;
};

type SreAssistantUiMessage = UIMessage<SreAssistantUiMessageMetadata>;

const MAX_MESSAGE_TEXT_LENGTH = 4000;
const MAX_TOTAL_MESSAGE_TEXT_LENGTH = 20_000;

const assistantUiTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_MESSAGE_TEXT_LENGTH),
}).passthrough();

const assistantUiMessageMetadataSchema = z.object({
  conversationId: z.string().uuid().optional(),
  assistantMessageId: z.string().uuid().optional(),
  modelId: z.string().trim().max(120).optional(),
}).passthrough();

const assistantUiMessageSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["user", "assistant"]),
  metadata: assistantUiMessageMetadataSchema.optional(),
  parts: z.array(assistantUiTextPartSchema).min(1).max(20),
}).passthrough();

const assistantUiChatRequestSchema = z.object({
  id: z.string().trim().max(200).optional().nullable(),
  conversationId: z.string().uuid().optional().nullable(),
  incidentId: z.null().optional(),
  messages: z.array(assistantUiMessageSchema).min(1).max(50),
});

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function getTextFromUiMessage(message: SreAssistantUiMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
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

function getTotalMessageTextLength(messages: SreAssistantUiMessage[]) {
  return messages.reduce((total, message) => total + getTextFromUiMessage(message).length, 0);
}

function buildAssistantUiSystemPrompt(projectName: string) {
  return [
    buildSreTriageSystemPrompt(),
    "",
    "Standalone Copilot chat rules:",
    `- Project: ${projectName}`,
    "- This chat is read-only. Do not suggest production mutations or destructive commands.",
    "- If no incident is scoped, do not claim incident evidence was inspected.",
    "- Prefer concise headings, short bullets, markdown tables for comparisons, and fenced code blocks for commands or queries.",
    "- Do not emit raw markdown heading markers as decoration; use headings only when they add structure.",
    "- When a small numeric summary is clearer as a chart and real values are available, include a fenced `chart` JSON block:",
    '{"type":"bar","title":"Short title","xKey":"label","series":[{"key":"value","label":"Value"}],"data":[{"label":"api","value":12}]}',
    "- Use only evidence or values from the conversation; do not fabricate chart data.",
  ].join("\n");
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

  if (!canInvestigate) {
    return NextResponse.json({ error: "Insufficient permissions to use Copilot" }, { status: 403 });
  }

  const rateLimit = await checkSreChatRateLimit(context.userId);
  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.resetTime ? Math.ceil((rateLimit.resetTime - Date.now()) / 1000) : 60;
    return NextResponse.json(
      { error: "Copilot chat rate limit reached. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid Copilot chat request" }, { status: 400 });
  }

  const parsed = assistantUiChatRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Copilot chat request" }, { status: 400 });
  }

  const messages = parsed.data.messages as SreAssistantUiMessage[];
  if (getTotalMessageTextLength(messages) > MAX_TOTAL_MESSAGE_TEXT_LENGTH) {
    return NextResponse.json({ error: "Copilot chat history is too large" }, { status: 413 });
  }

  const latestUserMessage = getLatestUserMessage(messages);
  const latestUserText = latestUserMessage ? getTextFromUiMessage(latestUserMessage) : "";
  if (!latestUserMessage || !latestUserText) {
    return NextResponse.json({ error: "Copilot chat message is required" }, { status: 400 });
  }

  try {
    validateAIConfiguration();
  } catch {
    return NextResponse.json({ error: "Copilot is not configured" }, { status: 503 });
  }

  let conversation = parsed.data.conversationId
    ? await getSreConversation({
        organizationId: context.organizationId,
        projectId: context.project.id,
        userId: context.userId,
        conversationId: parsed.data.conversationId,
      })
    : null;

  if (!conversation) {
    conversation = await createSreConversation({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      incidentId: null,
      title: latestUserText.slice(0, 80),
      scope: {
        source: "sre_assistant_ui_chat_api",
      },
    });
  }

  await appendSreMessage({
    organizationId: context.organizationId,
    projectId: context.project.id,
    userId: context.userId,
    conversationId: conversation.id,
    role: "user",
    content: latestUserText,
    attachments: [],
  });

  const budget = resolveSreAgentBudget({ maxSteps: 4, maxOutputTokens: 1200, timeoutMs: 45_000 });
  const system = buildAssistantUiSystemPrompt(context.project.name);
  const promptPreview = `${system}\n\n${latestUserText}`;
  assertSreAgentPromptWithinBudget(promptPreview, budget);

  const modelId = getActualModelName();
  let assistantMessageId: string | undefined;
  const activeConversationId = conversation.id;

  const result = streamText({
    model: getProviderModel(),
    system,
    messages: await convertToModelMessages(messages),
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
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) {
        return;
      }

      const assistantText = getTextFromUiMessage(responseMessage);
      if (!assistantText) {
        return;
      }

      const assistantMessage = await appendSreMessage({
        organizationId: context.organizationId,
        projectId: context.project.id,
        userId: context.userId,
        conversationId: activeConversationId,
        role: "assistant",
        content: assistantText,
        modelId,
      });
      assistantMessageId = assistantMessage.id;
    },
  });
}
