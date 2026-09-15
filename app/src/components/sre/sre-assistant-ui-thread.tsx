"use client";

import {
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { UIMessage } from "ai";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  unstable_useComposerInput,
  useAuiState,
  useMessagePartText,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import {
  Bot,
  ChevronDown,
  Loader2,
  PencilLine,
  Send,
  ShieldCheck,
  UserRound,
  RefreshCw,
  Copy,
  BarChart3,
  CheckCircle2,
} from "lucide-react";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { CopilotChatHelp } from "@/components/sre/sre-copilot-chat-help";
import {
  formatCopilotError,
  getQuickRepliesForAssistantText,
} from "@/components/sre/sre-generative-ui";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectContext } from "@/hooks/use-project-context";
import { canUseSreLiveConnectors } from "@/lib/rbac/permissions-client";

const SRE_COPILOT_MESSAGE_MAX_LENGTH = 4000;

const STANDALONE_STARTERS = [
  {
    label: "Triage a service issue",
    prompt: "Help me triage this service issue: ",
  },
  {
    label: "Review evidence",
    prompt: "Review this evidence and explain what it supports: ",
  },
  {
    label: "Choose next checks",
    prompt:
      "Given this symptom, list the safest read-only checks and explain what each result would tell me: ",
  },
] as const;

const INCIDENT_STARTERS = [
  {
    label: "Review stored evidence",
    prompt:
      "Summarize the strongest stored evidence for this incident and call out any gaps.",
  },
  {
    label: "Check a hypothesis",
    prompt: "Evaluate this hypothesis against the incident evidence: ",
  },
  {
    label: "Choose next checks",
    prompt:
      "List the next read-only checks for this incident and explain what each result would confirm or rule out.",
  },
] as const;

export type SreAssistantUiMessageMetadata = {
  conversationId?: string;
  assistantMessageId?: string;
  modelId?: string;
};

export type SreAssistantUiMessage = UIMessage<SreAssistantUiMessageMetadata>;

type SreAssistantUiThreadProps = {
  conversationId: string | null;
  incidentId?: string | null;
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
      className="group mb-5 flex gap-3"
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
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Regenerate response"
              title="Regenerate response"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
          <ActionBarPrimitive.Copy asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copy response"
              title="Copy response"
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
      className="group mb-5 flex justify-end gap-3"
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

function EmptyThread({
  incidentId,
  onClearError,
}: {
  incidentId: string | null;
  onClearError: () => void;
}) {
  const composer = unstable_useComposerInput();
  const starters = incidentId ? INCIDENT_STARTERS : STANDALONE_STARTERS;

  return (
    <ThreadPrimitive.Empty>
      <div className="flex w-full min-w-0 flex-col">
        <div className="mx-auto flex w-full min-h-[inherit] max-w-2xl flex-col justify-center p-3">
          <DashboardEmptyState
            icon={<Bot className="h-10 w-10 text-muted-foreground" />}
            title={
              incidentId
                ? "Investigate this incident"
                : "What do you need to investigate?"
            }
            description={
              incidentId
                ? "Review stored incident evidence, test a hypothesis, or choose the next safe checks. Live sources stay off until you enable them."
                : "Describe the symptom or paste evidence. Copilot separates known facts from assumptions and suggests safe next checks."
            }
            className="min-h-[320px]"
            action={
              <div className="mt-5 flex w-full flex-col gap-2">
                {starters.map((starter) => (
                  <Button
                    key={starter.label}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onClearError();
                      composer.setText(starter.prompt);
                    }}
                    className="h-auto justify-start rounded-xl px-3 py-2 text-left text-sm font-normal whitespace-normal bg-background"
                  >
                    <PencilLine className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">{starter.label}</span>
                  </Button>
                ))}
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
  onUseLiveConnectorToolsChange,
}: {
  onClearError: () => void;
  onUseLiveConnectorToolsChange: (enabled: boolean) => void;
}) {
  const composer = unstable_useComposerInput();
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
            if (reply.disableLiveConnectors) {
              onUseLiveConnectorToolsChange(false);
            }
            composer.setText(reply.prompt);
          }}
        >
          {reply.intent === "check" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : reply.intent === "chart" ? (
            <BarChart3 className="h-3.5 w-3.5 text-sky-500" />
          ) : null}
          {reply.label}
        </Button>
      ))}
    </div>
  );
}

function SreComposer({
  incidentId,
  useLiveConnectorTools,
  canUseLiveConnectors,
  onUseLiveConnectorToolsChange,
  onClearError,
}: {
  incidentId: string | null;
  useLiveConnectorTools: boolean;
  canUseLiveConnectors: boolean;
  onUseLiveConnectorToolsChange: (enabled: boolean) => void;
  onClearError: () => void;
}) {
  const composer = unstable_useComposerInput();

  function sendComposerMessage() {
    const messageText = composer.value.trim();
    if (!messageText) {
      return;
    }

    onClearError();
    composer.send();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendComposerMessage();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      sendComposerMessage();
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl rounded-2xl">
      <ComposerPrimitive.Root
        onSubmit={handleSubmit}
        className="relative flex w-full flex-col rounded-2xl border bg-background px-4 py-3 shadow-sm"
      >
        <div className="relative">
          <textarea
            value={composer.value}
            disabled={composer.isDisabled}
            aria-label="Message Copilot"
            onChange={(event) => composer.setText(event.target.value)}
            onKeyDown={handleInputKeyDown}
            maxLength={SRE_COPILOT_MESSAGE_MAX_LENGTH}
            placeholder={
              incidentId
                ? "Ask about this incident or its evidence..."
                : "Describe a symptom or paste evidence..."
            }
            rows={2}
            className="w-full max-h-44 min-h-16 resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </span>
          </div>
          {incidentId && canUseLiveConnectors ? (
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                id="copilot-live-connectors"
                checked={useLiveConnectorTools}
                onCheckedChange={onUseLiveConnectorToolsChange}
                aria-describedby="copilot-live-connectors-description"
                disabled={composer.isDisabled}
              />
              <Label htmlFor="copilot-live-connectors" className="text-xs">
                Live sources
              </Label>
              <span
                id="copilot-live-connectors-description"
                className="sr-only"
              >
                Allow this incident chat to query configured read-only
                connectors.
              </span>
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-2">
            <CopilotChatHelp />
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <Button type="button" variant="outline" size="sm">
                  Stop
                </Button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <Button type="submit" size="sm" disabled={!composer.canSend}>
                Send
                <Send className="h-4 w-4" />
              </Button>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

export function SreThread({
  incidentId,
  useLiveConnectorTools,
  canUseLiveConnectors,
  onUseLiveConnectorToolsChange,
  onClearError,
}: {
  incidentId: string | null;
  useLiveConnectorTools: boolean;
  canUseLiveConnectors: boolean;
  onUseLiveConnectorToolsChange: (enabled: boolean) => void;
  onClearError: () => void;
}) {
  return (
    <ThreadPrimitive.Root className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-muted/5">
      <ThreadPrimitive.Viewport
        autoScroll
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-5 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        <EmptyThread incidentId={incidentId} onClearError={onClearError} />
        <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col">
          <ThreadPrimitive.Messages>
            {({ message }) => {
              if (message.role === "user") return <UserMessage />;
              if (message.role === "assistant") return <AssistantMessage />;
              return null;
            }}
          </ThreadPrimitive.Messages>
          <AssistantThinking />
          <SreFollowUpSuggestions
            onClearError={onClearError}
            onUseLiveConnectorToolsChange={onUseLiveConnectorToolsChange}
          />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="sticky bottom-4 left-1/2 z-10 mx-auto mt-4 flex -translate-x-1/2 rounded-full shadow-sm disabled:hidden"
          >
            <ChevronDown className="h-4 w-4" />
            Jump to latest
          </Button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      <div className="w-full min-w-0 shrink-0 border-t bg-background/95 px-3 py-3 sm:px-5">
        <SreComposer
          incidentId={incidentId}
          useLiveConnectorTools={useLiveConnectorTools}
          canUseLiveConnectors={canUseLiveConnectors}
          onUseLiveConnectorToolsChange={onUseLiveConnectorToolsChange}
          onClearError={onClearError}
        />
      </div>
    </ThreadPrimitive.Root>
  );
}

export function SreAssistantUiThread({
  conversationId,
  incidentId = null,
  initialMessages,
  onConversationResolved,
  onClearError,
  onError,
}: SreAssistantUiThreadProps) {
  const { currentProject } = useProjectContext();
  const canUseLiveConnectors = canUseSreLiveConnectors(
    currentProject?.userRole,
  );
  const [useLiveConnectorTools, setUseLiveConnectorTools] = useState(false);
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
          incidentId,
          useLiveConnectorTools: useLiveConnectorTools && canUseLiveConnectors,
        },
      }),
    [conversationId, incidentId, useLiveConnectorTools, canUseLiveConnectors],
  );
  const runtime = useChatRuntime<SreAssistantUiMessage>({
    id: conversationId ?? undefined,
    messages: uiMessages,
    transport,
    onError: (error) => onError(formatCopilotError(error)),
    onFinish: ({ message, messages }) => {
      if (message.role === "assistant" && !textFromUiMessage(message)) {
        onError(
          "Copilot could not complete the read-only check. No failed connector result was treated as evidence.",
        );
      }
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
      <SreThread
        incidentId={incidentId}
        useLiveConnectorTools={useLiveConnectorTools && canUseLiveConnectors}
        canUseLiveConnectors={canUseLiveConnectors}
        onUseLiveConnectorToolsChange={setUseLiveConnectorTools}
        onClearError={onClearError}
      />
    </AssistantRuntimeProvider>
  );
}
