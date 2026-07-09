"use client";

import {
  useMemo,
  useState,
  type DragEvent,
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
  CheckCircle2,
  FileText,
  Paperclip,
  X,
} from "lucide-react";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import {
  buildAttachmentContextPrompt,
  createUserPromptMessage,
  formatCopilotError,
  getQuickRepliesForAssistantText,
  formatCopilotAttachmentSize,
  isSupportedCopilotAttachment,
  SRE_INLINE_CAPABILITIES_PREVIEW,
  SRE_COPILOT_ATTACHMENT_LIMITS,
  type SreCopilotAttachmentContext,
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

const SRE_MENTION_SHORTCUTS = [
  {
    label: "@incident",
    description: "Reference the selected incident context",
    value: "@incident ",
  },
  {
    label: "@service",
    description: "Reference an affected service",
    value: "@service ",
  },
  {
    label: "@recent-deploy",
    description: "Ask Copilot to consider recent deploy context",
    value: "@recent-deploy ",
  },
];

type PendingCopilotAttachment = SreCopilotAttachmentContext & {
  id: string;
};

function appendUserPrompt(thread: ThreadRuntime, prompt: string) {
  thread.append(createUserPromptMessage(prompt));
}

function appendInlinePreview(thread: ThreadRuntime) {
  thread.append({
    role: "assistant",
    content: [{ type: "text", text: SRE_INLINE_CAPABILITIES_PREVIEW }],
  });
}

async function readCopilotAttachment(
  file: File,
): Promise<PendingCopilotAttachment> {
  if (!isSupportedCopilotAttachment(file)) {
    throw new Error(
      "Attach text, log, JSON, CSV, or Markdown files only for Copilot context.",
    );
  }

  if (file.size > SRE_COPILOT_ATTACHMENT_LIMITS.maxFileSizeBytes) {
    throw new Error(
      `Attachments must be ${formatCopilotAttachmentSize(SRE_COPILOT_ATTACHMENT_LIMITS.maxFileSizeBytes)} or smaller.`,
    );
  }

  const content = await file.text();
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    fileName: file.name,
    mimeType: file.type || "text/plain",
    size: file.size,
    content,
  };
}

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
          {reply.intent === "verify" ? (
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

function SreComposer({ onClearError }: { onClearError: () => void }) {
  const thread = useThreadRuntime();
  const composer = unstable_useComposerInput();
  const [attachments, setAttachments] = useState<PendingCopilotAttachment[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activeMentionMatch = /(^|\s)(@[\w-]*)$/.exec(composer.value);
  const mentionQuery = activeMentionMatch?.[2].toLowerCase() ?? "";
  const mentionOptions =
    mentionQuery.length > 0
      ? SRE_MENTION_SHORTCUTS.filter((mention) =>
          mention.label.toLowerCase().startsWith(mentionQuery),
        )
      : [];

  async function addFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    const availableSlots =
      SRE_COPILOT_ATTACHMENT_LIMITS.maxFiles - attachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(
        `Attach up to ${SRE_COPILOT_ATTACHMENT_LIMITS.maxFiles} files per message.`,
      );
      return;
    }

    try {
      const next = await Promise.all(
        files.slice(0, availableSlots).map(readCopilotAttachment),
      );
      setAttachments((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...next.filter((item) => {
            if (seen.has(item.id)) {
              return false;
            }
            seen.add(item.id);
            return true;
          }),
        ];
      });
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Attachment could not be read.",
      );
    }
  }

  async function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDragging(false);
    await addFiles(Array.from(event.dataTransfer.files));
  }

  function sendComposerMessage() {
    const messageText = composer.value.trim();
    if (!messageText) {
      if (attachments.length > 0) {
        setAttachmentError("Add a short question before sending attachments.");
      }
      return;
    }

    setAttachmentError(null);
    if (attachments.length > 0) {
      const attachmentContext = buildAttachmentContextPrompt(attachments);
      composer.setText(
        [
          messageText,
          "Attached context:",
          attachmentContext,
        ].join("\n\n"),
      );
      setAttachments([]);
    }

    onClearError();
    composer.send();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendComposerMessage();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendComposerMessage();
    }
  }

  function insertMention(value: string) {
    const nextText = activeMentionMatch
      ? `${composer.value.slice(0, activeMentionMatch.index)}${activeMentionMatch[1]}${value}`
      : `${composer.value}${composer.value.endsWith(" ") ? "" : " "}${value}`;
    composer.setText(nextText);
  }

  return (
    <div className="mx-auto w-full max-w-4xl rounded-2xl">
      <ComposerPrimitive.Root
        onSubmit={handleSubmit}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !event.currentTarget.contains(next)) {
            setIsDragging(false);
          }
        }}
        onDrop={handleDrop}
        className={`relative flex w-full flex-col rounded-2xl border bg-background px-4 py-3 shadow-sm transition-colors ${
          isDragging ? "border-primary bg-primary/5" : ""
        }`}
      >
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
          {SRE_MENTION_SHORTCUTS.map((mention) => (
            <Button
              key={mention.label}
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground"
              onClick={() => insertMention(mention.value)}
              title={mention.description}
            >
              {mention.label}
            </Button>
          ))}
        </div>
        {attachments.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border bg-muted/40 px-2 py-1 text-xs"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{attachment.fileName}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatCopilotAttachmentSize(attachment.size)}
                </span>
                <button
                  type="button"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="relative">
          <textarea
            value={composer.value}
            disabled={composer.isDisabled}
            onChange={(event) => composer.setText(event.target.value)}
            onKeyDown={handleInputKeyDown}
          placeholder="Ask Copilot about an incident, service, or verification plan..."
            rows={2}
            className="w-full max-h-44 min-h-16 resize-none border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          {mentionOptions.length > 0 ? (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-xl border bg-popover shadow-lg">
              {mentionOptions.map((mention) => (
                <button
                  key={mention.label}
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => insertMention(mention.value)}
                >
                  <span className="font-medium">{mention.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {mention.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {attachmentError ? (
          <p className="mt-2 text-xs text-destructive">{attachmentError}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </span>
            <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
              <Paperclip className="h-3.5 w-3.5" />
              Drop logs
            </span>
            <span className="ml-2 hidden truncate lg:inline">
              Slash commands, mentions, and local text attachments stay
              read-only.
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
              <Button type="submit" size="sm">
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
  incidentId = null,
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
          incidentId,
          useLiveConnectorTools: Boolean(incidentId),
        },
      }),
    [conversationId, incidentId],
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
