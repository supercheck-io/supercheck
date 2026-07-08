"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  useAuiState,
  useMessagePartText,
  useThreadRuntime,
  type ThreadRuntime,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import {
  Bot,
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Send,
  ShieldCheck,
  UserRound,
  RefreshCw,
  Copy,
  BarChart3,
} from "lucide-react";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import {
  createUserPromptMessage,
  formatCopilotError,
  getQuickRepliesForAssistantText,
  SRE_INLINE_CAPABILITIES_PREVIEW,
} from "@/components/sre/sre-generative-ui";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SRE_AI_SUGGESTIONS = [
  "Inspect system health",
  "Plan checkout incident triage",
  "Summarize evidence gaps",
  "Draft a verification plan",
];

const SRE_COMMAND_SHORTCUTS = [
  {
    label: "/health",
    prompt:
      "/health Inspect current system health and summarize the most important signals as tables or charts when data is available.",
  },
  {
    label: "/investigate",
    prompt:
      "/investigate Help me investigate the currently selected service or incident using only read-only evidence and verification steps.",
  },
  {
    label: "/evidence",
    prompt:
      "/evidence Show the strongest evidence, gaps, and next read-only checks. Use inline charts for numeric series when possible.",
  },
  {
    label: "/verify",
    prompt:
      "/verify Build a read-only verification plan with concrete checks I can run before taking action.",
  },
];

function appendUserPrompt(thread: ThreadRuntime, prompt: string) {
  thread.append(createUserPromptMessage(prompt));
}

function appendInlinePreview(thread: ThreadRuntime) {
  thread.append({
    role: "assistant",
    content: [{ type: "text", text: SRE_INLINE_CAPABILITIES_PREVIEW }],
  });
}

export type SreAssistantUiMessageMetadata = {
  conversationId?: string;
  assistantMessageId?: string;
  modelId?: string;
};

export type SreAssistantUiMessage = UIMessage<SreAssistantUiMessageMetadata>;

type SreAssistantUiThreadProps = {
  conversationId: string | null;
  initialMessages: SreStandaloneChatHistory["messages"];
  onConversationResolved: (input: {
    conversationId: string;
    messages: SreStandaloneChatHistory["messages"];
    title: string;
  }) => void;
  onClearError: () => void;
  onError: (message: string) => void;
};

export function historyMessagesToUiMessages(
  messages: SreStandaloneChatHistory["messages"],
): SreAssistantUiMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    metadata: message.modelId ? { modelId: message.modelId } : undefined,
    parts: [{ type: "text", text: message.content }],
  }));
}

function textFromUiMessage(message: SreAssistantUiMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function textFromThreadMessage(message: {
  content?: unknown;
  parts?: unknown;
}) {
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];

  return parts
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) {
        return [];
      }

      const record = part as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n")
    .trim();
}

export function uiMessagesToHistoryMessages(
  messages: SreAssistantUiMessage[],
): SreStandaloneChatHistory["messages"] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const content = textFromUiMessage(message);
    if (!content) {
      return [];
    }

    return [
      {
        id: message.metadata?.assistantMessageId ?? message.id,
        role: message.role,
        content,
        modelId: message.metadata?.modelId ?? null,
      },
    ];
  });
}

function AssistantTextPart() {
  const part = useMessagePartText();
  return <SreMessageContent content={part.text} />;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="group flex gap-3"
      aria-label="Copilot message"
    >
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border bg-background px-4 py-3 text-sm leading-6 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Copilot</Badge>
        </div>
        <MessagePrimitive.Content components={{ Text: AssistantTextPart }} />
        <ActionBarPrimitive.Root
          hideWhenRunning
          className="mt-2 flex items-center gap-2"
        >
          <ActionBarPrimitive.Reload asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
          <ActionBarPrimitive.Copy asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
        <BranchPickerPrimitive.Root
          hideWhenSingleBranch
          className="mt-2 flex w-fit items-center gap-1 rounded border bg-muted/50 px-1 py-0.5 text-xs text-muted-foreground"
        >
          <BranchPickerPrimitive.Previous className="rounded-sm hover:bg-background p-0.5 transition-colors" />
          <span className="font-medium">
            <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
          </span>
          <BranchPickerPrimitive.Next className="rounded-sm hover:bg-background p-0.5 transition-colors" />
        </BranchPickerPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root
      className="group flex justify-end gap-3"
      aria-label="User message"
    >
      <div className="max-w-[82%] rounded-2xl rounded-tr-md border bg-muted/70 px-4 py-3 text-sm leading-6 text-foreground shadow-sm sm:max-w-[62%]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">You</Badge>
        </div>
        <MessagePrimitive.Content components={{ Text: AssistantTextPart }} />
        <BranchPickerPrimitive.Root
          hideWhenSingleBranch
          className="mt-2 ml-auto flex w-fit items-center gap-1 rounded border bg-background/50 px-1 py-0.5 text-xs text-muted-foreground"
        >
          <BranchPickerPrimitive.Previous className="rounded-sm hover:bg-background p-0.5 transition-colors" />
          <span className="font-medium">
            <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
          </span>
          <BranchPickerPrimitive.Next className="rounded-sm hover:bg-background p-0.5 transition-colors" />
        </BranchPickerPrimitive.Root>
      </div>
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
        <UserRound className="h-4 w-4 text-muted-foreground" />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantThinking() {
  return (
    <ThreadPrimitive.If running>
      <div
        role="status"
        aria-live="polite"
        className="mx-auto flex w-full max-w-4xl gap-3"
      >
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 rounded-2xl border border-dashed bg-muted/20 px-4 py-3 text-sm leading-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Copilot</Badge>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Reading the context and preparing a response...
            </span>
          </div>
        </div>
      </div>
    </ThreadPrimitive.If>
  );
}

function EmptyThread({ onClearError }: { onClearError: () => void }) {
  const thread = useThreadRuntime();

  return (
    <ThreadPrimitive.Empty>
      <div className="flex w-full min-w-0 flex-col">
        <div className="mx-auto flex w-full min-h-[inherit] max-w-2xl flex-col justify-center p-3">
          <DashboardEmptyState
            icon={<Bot className="h-10 w-10 text-muted-foreground" />}
            title="Hello! I am your AI SRE Copilot."
            description="Use Copilot for read-only triage plans, evidence checklists, and verification steps. Open an incident when you need cited evidence."
            className="min-h-[320px]"
            action={
              <div className="mt-5 flex w-full flex-col gap-2">
                {SRE_AI_SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onClearError();
                      appendUserPrompt(thread, suggestion);
                    }}
                    className="h-auto justify-start rounded-xl px-3 py-2 text-left text-sm font-normal whitespace-normal bg-background"
                  >
                    <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">{suggestion}</span>
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onClearError();
                    appendInlinePreview(thread);
                  }}
                  className="h-auto justify-start rounded-xl px-3 py-2 text-left text-sm font-normal whitespace-normal"
                >
                  <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">Preview inline charts</span>
                </Button>
              </div>
            }
          />
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
}

function SreFollowUpSuggestions({
  onClearError,
}: {
  onClearError: () => void;
}) {
  const thread = useThreadRuntime();
  const latestAssistantText = useAuiState((state) => {
    const messages = state.thread.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "assistant") {
        return textFromThreadMessage(message);
      }
    }

    return "";
  });
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const replies = latestAssistantText
    ? getQuickRepliesForAssistantText(latestAssistantText)
    : [];

  if (isRunning || !latestAssistantText || replies.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-2">
      {replies.map((reply) => (
        <Button
          key={reply.label}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto rounded-full px-3 py-1.5 text-xs font-normal"
          onClick={() => {
            onClearError();
            appendUserPrompt(thread, reply.prompt);
          }}
        >
          {reply.label}
        </Button>
      ))}
    </div>
  );
}

function SreComposer({ onClearError }: { onClearError: () => void }) {
  const thread = useThreadRuntime();

  return (
    <ComposerPrimitive.AttachmentDropzone
      disabled
      className="mx-auto w-full max-w-4xl rounded-2xl data-[dragging]:border-primary"
    >
      <ComposerPrimitive.Root className="flex w-full flex-col rounded-2xl border bg-background px-4 py-3 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          {SRE_COMMAND_SHORTCUTS.map((shortcut) => (
            <Button
              key={shortcut.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs font-normal"
              onClick={() => {
                onClearError();
                appendUserPrompt(thread, shortcut.prompt);
              }}
            >
              {shortcut.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs font-normal"
            onClick={() => {
              onClearError();
              appendInlinePreview(thread);
            }}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Preview charts
          </Button>
        </div>
        <ComposerPrimitive.Input
          placeholder="Ask Copilot about an incident, service, or verification plan..."
          submitMode="enter"
          rows={2}
          className="w-full max-h-44 min-h-16 resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </span>
            <span className="ml-2 hidden truncate lg:inline">
              Slash commands and quick replies are read-only. Chart preview uses
              local sample data.
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <Button type="button" variant="outline" size="sm">
                  Stop
                </Button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <Button type="submit" size="sm">
                  Send
                  <Send className="h-4 w-4" />
                </Button>
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.AttachmentDropzone>
  );
}

export function SreThread({ onClearError }: { onClearError: () => void }) {
  return (
    <ThreadPrimitive.Root className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-muted/5">
      <ThreadPrimitive.Viewport
        autoScroll
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-5 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        <EmptyThread onClearError={onClearError} />
        <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5">
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
          <AssistantThinking />
          <SreFollowUpSuggestions onClearError={onClearError} />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="sticky bottom-4 left-1/2 z-10 mx-auto mt-4 flex -translate-x-1/2 rounded-full shadow-sm"
          >
            <ChevronDown className="h-4 w-4" />
            New messages
          </Button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      <div className="w-full min-w-0 shrink-0 border-t bg-background/95 px-3 py-3 sm:px-5">
        <SreComposer onClearError={onClearError} />
      </div>
    </ThreadPrimitive.Root>
  );
}

export function SreAssistantUiThread({
  conversationId,
  initialMessages,
  onConversationResolved,
  onClearError,
  onError,
}: SreAssistantUiThreadProps) {
  const uiMessages = useMemo(
    () => historyMessagesToUiMessages(initialMessages),
    [initialMessages],
  );
  const transport = useMemo(
    () =>
      new AssistantChatTransport<SreAssistantUiMessage>({
        api: "/api/sre/chat/assistant-ui",
        body: {
          conversationId,
          incidentId: null,
        },
      }),
    [conversationId],
  );
  const runtime = useChatRuntime<SreAssistantUiMessage>({
    id: conversationId ?? undefined,
    messages: uiMessages,
    transport,
    onError: (error) => onError(formatCopilotError(error)),
    onFinish: ({ message, messages }) => {
      const resolvedConversationId = message.metadata?.conversationId;
      if (!resolvedConversationId) {
        return;
      }

      const historyMessages = uiMessagesToHistoryMessages(messages);
      const firstUserMessage = historyMessages.find(
        (item) => item.role === "user",
      );
      onConversationResolved({
        conversationId: resolvedConversationId,
        messages: historyMessages,
        title: firstUserMessage?.content.slice(0, 80) || "Copilot session",
      });
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SreThread onClearError={onClearError} />
    </AssistantRuntimeProvider>
  );
}
