"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Archive, Bot, CheckCircle2, Clock3, MessageSquare, Plus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { archiveSreStandaloneChat, type SreStandaloneChatHistory } from "@/actions/sre-ai";
import { SreChatInput } from "@/components/sre/chat-input";
import { SreChatMessageList, type SreChatMessage } from "@/components/sre/chat-message-list";
import { summarizeSreAgentProgressEvent, type SreInvestigationProgressEvent } from "@/components/sre/investigation-progress-card";
import { parseSreSseEvents, sreSseDataRecord } from "@/components/sre/sre-sse-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const SRE_AI_SUGGESTIONS = [
  "What should I check first for a latency incident?",
  "Build an investigation plan for checkout failures.",
  "What evidence do I need before calling root cause?",
  "How should I verify a fix without changing production?",
];

type SreAiConsoleProps = {
  initialHistories?: SreStandaloneChatHistory[];
  loadError?: string | null;
};

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recent";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function getLatestProgress(events: SreInvestigationProgressEvent[]) {
  return events.at(-1);
}

function ThinkingRow({ isPending, events }: { isPending: boolean; events: SreInvestigationProgressEvent[] }) {
  if (!isPending && events.length === 0) {
    return null;
  }

  const latest = getLatestProgress(events);

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
      {isPending ? <Spinner className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
      <span>{isPending ? latest?.title ?? "Thinking" : "Response complete"}</span>
      {latest?.description && <span className="hidden truncate sm:inline">· {latest.description}</span>}
    </div>
  );
}

export function SreAiConsole({ initialHistories = [], loadError = null }: SreAiConsoleProps) {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [histories, setHistories] = useState(initialHistories);
  const [historyQuery, setHistoryQuery] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(initialHistories[0]?.conversationId ?? null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<SreChatMessage[]>(initialHistories[0]?.messages ?? []);
  const [progressEvents, setProgressEvents] = useState<SreInvestigationProgressEvent[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [isArchiving, startArchiveTransition] = useTransition();

  useEffect(() => {
    setHistories(initialHistories);
    if (!conversationId && initialHistories[0]) {
      setConversationId(initialHistories[0].conversationId);
      setMessages(initialHistories[0].messages);
    }
  }, [conversationId, initialHistories]);

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages, isPending]);

  const filteredHistories = histories.filter((history) => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [history.title, ...history.messages.map((message) => message.content)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setPrompt("");
    setProgressEvents([]);
    setError(null);
  };

  const selectHistory = (history: SreStandaloneChatHistory) => {
    setConversationId(history.conversationId);
    setMessages(history.messages);
    setPrompt("");
    setProgressEvents([]);
    setError(null);
  };

  const archiveCurrentChat = () => {
    if (!conversationId || isArchiving) {
      return;
    }

    startArchiveTransition(async () => {
      const result = await archiveSreStandaloneChat({ conversationId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setHistories((current) => current.filter((history) => history.conversationId !== conversationId));
      startNewChat();
      router.refresh();
      toast.success("Chat archived");
    });
  };

  const submitPrompt = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isPending) {
      return;
    }

    const submittedMessage = { id: `local-${Date.now()}`, role: "user" as const, content: trimmed, modelId: null };

    setIsPending(true);
    setError(null);
    setProgressEvents([]);
    setMessages((current) => [...current, submittedMessage]);

    try {
      const response = await fetch("/api/sre/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          incidentId: null,
          message: trimmed,
          title: trimmed.slice(0, 80),
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "SRE AI chat failed");
      }

      const streamedMessages: SreStandaloneChatHistory["messages"] = [
        ...messages.map((message) => ({ ...message, modelId: message.modelId ?? null })),
        submittedMessage,
      ];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activeConversationId = conversationId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSreSseEvents(buffer);
        buffer = parsed.remaining;

        for (const event of parsed.events) {
          const data = sreSseDataRecord(event.data);
          const progress = summarizeSreAgentProgressEvent(event.event, event.data);
          if (progress) {
            setProgressEvents((current) => [...current, { id: `${event.event}-${Date.now()}-${current.length}`, ...progress }]);
          }

          if (event.event === "conversation" && typeof data.id === "string") {
            activeConversationId = data.id;
            setConversationId(data.id);
          }

          if (event.event === "message" && data.role === "assistant" && typeof data.content === "string") {
            const assistantMessage = {
              id: typeof data.id === "string" ? data.id : `assistant-${Date.now()}`,
              role: "assistant" as const,
              content: data.content,
              modelId: typeof data.modelId === "string" ? data.modelId : null,
            };

            streamedMessages.push(assistantMessage);
            setMessages((current) => [...current, assistantMessage]);
          }

          if (event.event === "error" && typeof data.message === "string") {
            throw new Error(data.message);
          }
        }
      }

      setHistories((current) => {
        if (!activeConversationId) {
          return current;
        }

        const withoutActive = current.filter((history) => history.conversationId !== activeConversationId);
        return [{ conversationId: activeConversationId, title: trimmed.slice(0, 80), updatedAt: new Date().toISOString(), messages: streamedMessages }, ...withoutActive];
      });

      setPrompt("");
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SRE AI chat failed";
      setError(message);
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r bg-muted/10 md:flex md:flex-col">
        <div className="space-y-3 border-b p-3">
          <Button type="button" className="w-full justify-start" onClick={startNewChat}>
            <Plus className="h-4 w-4" />
            New chat
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search chats"
              className="h-9 border-0 bg-muted/40 pl-8 shadow-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filteredHistories.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-muted-foreground">
              {historyQuery.trim() ? "No chats match your search." : "Chat history will appear here."}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredHistories.map((history) => {
                const isActive = history.conversationId === conversationId;
                return (
                  <button
                    key={history.conversationId}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => selectHistory(history)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-background shadow-sm ring-1 ring-border"
                    )}
                  >
                    <span className="block truncate font-medium">{history.title ?? "SRE AI chat"}</span>
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <time dateTime={history.updatedAt}>{formatHistoryDate(history.updatedAt)}</time> · {history.messages.length} messages
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Read-only SRE guidance. Open an incident for cited evidence.
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">SRE AI</h1>
              <p className="truncate text-xs text-muted-foreground">Ask, investigate, and plan verification without production writes.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conversationId && (
              <Button type="button" variant="ghost" size="sm" onClick={archiveCurrentChat} disabled={isArchiving || isPending}>
                {isArchiving ? <Spinner className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                <span className="hidden sm:inline">Archive</span>
              </Button>
            )}
            <Badge variant="secondary" className="hidden rounded-full sm:inline-flex">No remediation</Badge>
          </div>
        </header>

        {error && (
          <div className="shrink-0 px-3 pt-3 sm:px-5">
            <Alert variant="destructive">
              <AlertTitle>SRE AI unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,_hsl(var(--muted)/0.35),_transparent_36%)]">
          <SreChatMessageList
            messages={messages}
            emptyIcon={<MessageSquare className="h-8 w-8 text-muted-foreground" />}
            emptyTitle="How can I help investigate?"
            emptyDescription="Ask a reliability question, request an investigation plan, or choose a prompt below. Use incident detail for cited evidence and live connector context."
            className="h-full rounded-none border-0 shadow-none"
            bottomRef={messagesEndRef}
          />
        </section>

        <ThinkingRow isPending={isPending} events={progressEvents} />

        {messages.length === 0 && !isPending && (
          <div className="mx-auto grid w-full max-w-3xl shrink-0 grid-cols-1 gap-2 px-3 pb-2 sm:grid-cols-2">
            {SRE_AI_SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                onClick={() => setPrompt(suggestion)}
                className="h-auto justify-start rounded-xl bg-background px-3 py-2 text-left font-normal whitespace-normal"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )}

        <div className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-5">
          <div className="mx-auto max-w-3xl">
            <SreChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={submitPrompt}
              isPending={isPending}
              placeholder="Message SRE AI..."
              footer="Project chat history is saved. Incident evidence is only attached from incident pages."
              submitLabel="Send"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
