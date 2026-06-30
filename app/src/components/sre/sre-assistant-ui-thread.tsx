"use client";

import { useMemo } from "react";
import type { UIMessage } from "ai";
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, ActionBarPrimitive, BranchPickerPrimitive, useAuiState, useMessagePartText, useThreadRuntime } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Bot, ChevronDown, CornerDownLeft, Loader2, Send, ShieldCheck, UserRound, RefreshCw, Copy, Check } from "lucide-react";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { SreMessageContent } from "@/components/sre/chat-message-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SRE_AI_SUGGESTIONS = [
  "Inspect system health",
  "Plan checkout incident triage",
  "Summarize evidence gaps",
  "Draft a verification plan",
];

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
  onError: (message: string) => void;
};

export function historyMessagesToUiMessages(messages: SreStandaloneChatHistory["messages"]): SreAssistantUiMessage[] {
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

export function uiMessagesToHistoryMessages(messages: SreAssistantUiMessage[]): SreStandaloneChatHistory["messages"] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const content = textFromUiMessage(message);
    if (!content) {
      return [];
    }

    return [{
      id: message.metadata?.assistantMessageId ?? message.id,
      role: message.role,
      content,
      modelId: message.metadata?.modelId ?? null,
    }];
  });
}

function AssistantTextPart() {
  const part = useMessagePartText();
  return <SreMessageContent content={part.text} />;
}

function useMessageMetadata() {
  return useAuiState((state) => {
    const metadata = state.message.metadata as SreAssistantUiMessageMetadata | undefined;
    return metadata ?? {};
  });
}

function AssistantMessage() {
  const metadata = useMessageMetadata();

  return (
    <MessagePrimitive.Root className="group flex gap-3" aria-label="Copilot message">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border bg-background px-4 py-3 text-sm leading-6 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Copilot</Badge>
          {metadata.modelId && <span className="text-xs text-muted-foreground">{metadata.modelId}</span>}
        </div>
        <MessagePrimitive.Content components={{ Text: AssistantTextPart }} />
        <ActionBarPrimitive.Root hideWhenRunning className="mt-2 flex items-center gap-2">
          <ActionBarPrimitive.Reload asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
          <ActionBarPrimitive.Copy asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
        <BranchPickerPrimitive.Root hideWhenSingleBranch className="mt-2 flex w-fit items-center gap-1 rounded border bg-muted/50 px-1 py-0.5 text-xs text-muted-foreground">
          <BranchPickerPrimitive.Previous className="rounded-sm hover:bg-background p-0.5 transition-colors" />
          <span className="font-medium"><BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count /></span>
          <BranchPickerPrimitive.Next className="rounded-sm hover:bg-background p-0.5 transition-colors" />
        </BranchPickerPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="group flex justify-end gap-3" aria-label="User message">
      <div className="max-w-[82%] rounded-2xl rounded-tr-md border bg-muted/70 px-4 py-3 text-sm leading-6 text-foreground shadow-sm sm:max-w-[62%]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">You</Badge>
        </div>
        <MessagePrimitive.Content components={{ Text: AssistantTextPart }} />
        <BranchPickerPrimitive.Root hideWhenSingleBranch className="mt-2 ml-auto flex w-fit items-center gap-1 rounded border bg-background/50 px-1 py-0.5 text-xs text-muted-foreground">
          <BranchPickerPrimitive.Previous className="rounded-sm hover:bg-background p-0.5 transition-colors" />
          <span className="font-medium"><BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count /></span>
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
      <div role="status" aria-live="polite" className="mx-auto flex w-full max-w-4xl gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 rounded-2xl border border-dashed bg-muted/20 px-4 py-3 text-sm leading-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Copilot</Badge>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Reading the context and preparing a response...</span>
          </div>
        </div>
      </div>
    </ThreadPrimitive.If>
  );
}

function EmptyThread() {
  const thread = useThreadRuntime();

  return (
    <ThreadPrimitive.Empty>
      <div className="mx-auto flex min-h-[inherit] max-w-2xl flex-col justify-center p-4">
        <DashboardEmptyState
          icon={<Bot className="h-10 w-10 text-muted-foreground" />}
          title="Hello! I am your AI SRE Copilot."
          description="Use Copilot for read-only triage plans, evidence checklists, and verification steps. Open an incident when you need cited evidence."
          className="min-h-[400px]"
          action={
            <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
              {SRE_AI_SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  onClick={() => thread.append(suggestion)}
                  className="h-auto justify-start rounded-xl px-3 py-2 text-left text-sm font-normal whitespace-normal bg-background"
                >
                  <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">{suggestion}</span>
                </Button>
              ))}
            </div>
          }
        />
      </div>
    </ThreadPrimitive.Empty>
  );
}

function SreComposer() {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-4xl flex-col rounded-2xl border bg-background px-4 py-3 shadow-sm">
      <ComposerPrimitive.Input
        placeholder="Ask Copilot about an incident, service, or verification plan..."
        submitMode="enter"
        rows={2}
        className="max-h-44 min-h-16 resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Read-only
          </span>
          <span className="ml-2 hidden sm:inline">Project history is saved. Incident evidence is attached from incident pages.</span>
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
  );
}

export function SreThread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-muted/5">
      <ThreadPrimitive.Viewport
        autoScroll
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        className="min-h-0 flex-1 overflow-y-auto px-3 py-5 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        <EmptyThread />
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <AssistantThinking />
        </div>
        <ThreadPrimitive.ScrollToBottom asChild>
          <Button type="button" variant="secondary" size="sm" className="sticky bottom-4 left-1/2 z-10 mx-auto mt-4 flex -translate-x-1/2 rounded-full shadow-sm">
            <ChevronDown className="h-4 w-4" />
            New messages
          </Button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
      <div className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-5">
        <SreComposer />
      </div>
    </ThreadPrimitive.Root>
  );
}

export function SreAssistantUiThread({
  conversationId,
  initialMessages,
  onConversationResolved,
  onError,
}: SreAssistantUiThreadProps) {
  const uiMessages = useMemo(() => historyMessagesToUiMessages(initialMessages), [initialMessages]);
  const transport = useMemo(
    () =>
      new AssistantChatTransport<SreAssistantUiMessage>({
        api: "/api/sre/chat/assistant-ui",
        body: {
          conversationId,
          incidentId: null,
        },
      }),
    [conversationId]
  );
  const runtime = useChatRuntime<SreAssistantUiMessage>({
    id: conversationId ?? undefined,
    messages: uiMessages,
    transport,
    onError: (error) => onError(error instanceof Error ? error.message : "Copilot chat failed"),
    onFinish: ({ message, messages }) => {
      const resolvedConversationId = message.metadata?.conversationId;
      if (!resolvedConversationId) {
        return;
      }

      const historyMessages = uiMessagesToHistoryMessages(messages);
      const firstUserMessage = historyMessages.find((item) => item.role === "user");
      onConversationResolved({
        conversationId: resolvedConversationId,
        messages: historyMessages,
        title: firstUserMessage?.content.slice(0, 80) || "Copilot session",
      });
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SreThread />
    </AssistantRuntimeProvider>
  );
}
