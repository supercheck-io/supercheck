"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Archive,
  Bot,
  History as HistoryIcon,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import {
  archiveSreCopilotChat,
  type SreCopilotChatHistory,
} from "@/actions/sre-ai";
import { SreAssistantUiThread } from "@/components/sre/sre-assistant-ui-thread";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type SreAiConsoleProps = {
  initialHistories?: SreCopilotChatHistory[];
  initialIncidentId?: string | null;
  loadError?: string | null;
  onHistoriesChange?: (histories: SreCopilotChatHistory[]) => void;
};

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function SreAiConsole({
  initialHistories = [],
  initialIncidentId = null,
  loadError = null,
  onHistoriesChange,
}: SreAiConsoleProps) {
  const initialHistory = initialIncidentId
    ? initialHistories.find(
        (history) => history.incidentId === initialIncidentId,
      )
    : initialHistories.find((history) => history.incidentId === null);
  const [incidentId, setIncidentId] = useState<string | null>(
    initialIncidentId ?? initialHistory?.incidentId ?? null,
  );
  const [histories, setHistories] = useState(initialHistories);
  const [historyQuery, setHistoryQuery] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    initialHistory?.conversationId ?? null,
  );
  const [activeMessages, setActiveMessages] = useState<
    SreCopilotChatHistory["messages"]
  >(initialHistory?.messages ?? []);
  const [error, setError] = useState<string | null>(loadError);
  const [threadKey, setThreadKey] = useState(
    initialHistory?.conversationId ?? "new",
  );
  const [isArchiving, startArchiveTransition] = useTransition();

  useEffect(() => {
    setHistories(initialHistories);
  }, [initialHistories]);

  useEffect(() => {
    onHistoriesChange?.(histories);
  }, [histories, onHistoriesChange]);

  const filteredHistories = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) {
      return histories;
    }

    return histories.filter((history) =>
      [history.title, ...history.messages.map((message) => message.content)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [histories, historyQuery]);

  const startNewChat = () => {
    setIsHistoryOpen(false);
    setConversationId(null);
    setActiveMessages([]);
    setError(null);
    setThreadKey(`new-${Date.now()}`);
  };

  const selectHistory = (history: SreCopilotChatHistory) => {
    setIsHistoryOpen(false);
    setConversationId(history.conversationId);
    setIncidentId(history.incidentId);
    window.history.replaceState(
      window.history.state,
      "",
      history.incidentId
        ? `/copilot?incident=${history.incidentId}`
        : "/copilot",
    );
    setActiveMessages(history.messages);
    setError(null);
    setThreadKey(history.conversationId);
  };

  const archiveCurrentChat = () => {
    if (!conversationId || isArchiving) {
      return;
    }

    startArchiveTransition(async () => {
      const result = await archiveSreCopilotChat({ conversationId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setHistories((current) =>
        current.filter((history) => history.conversationId !== conversationId),
      );
      startNewChat();
      toast.success("Copilot session archived");
    });
  };

  const handleConversationResolved = (input: {
    conversationId: string;
    messages: SreCopilotChatHistory["messages"];
    title: string;
  }) => {
    setConversationId(input.conversationId);
    setActiveMessages(input.messages);
    setHistories((current) => {
      const withoutActive = current.filter(
        (history) => history.conversationId !== input.conversationId,
      );
      return [
        {
          conversationId: input.conversationId,
          title: input.title,
          incidentId,
          updatedAt: new Date().toISOString(),
          messages: input.messages,
        },
        ...withoutActive,
      ];
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <SheetContent side="left" className="w-[min(22rem,88vw)] gap-0 p-0">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Chat history</SheetTitle>
            <SheetDescription>Your saved Copilot chats</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                aria-label="Search history"
                placeholder="Search history"
                className="h-9 border-0 bg-muted/40 pl-8 shadow-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredHistories.length === 0 ? (
              <div className="px-2 py-8 text-center text-sm text-muted-foreground">
                {historyQuery.trim()
                  ? "No Copilot chats match your search."
                  : "Saved Copilot chats will appear here."}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredHistories.map((history) => {
                  const isActive = history.conversationId === conversationId;
                  return (
                    <button
                      key={history.conversationId}
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => selectHistory(history)}
                      className={cn(
                        "w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "bg-muted ring-1 ring-border",
                      )}
                    >
                      <span className="block truncate font-medium">
                        {history.title ?? "Copilot chat"}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <time dateTime={history.updatedAt}>
                          {formatHistoryDate(history.updatedAt)}
                        </time>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 flex-col gap-2 border-b bg-background/95 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden h-8 w-8 items-center justify-center rounded-full sm:flex border bg-background shadow-sm">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Copilot</h1>
              <p className="truncate text-xs text-muted-foreground">
                {incidentId
                  ? "Incident evidence and connected sources."
                  : "Ask about your services and connected sources."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="History"
              aria-expanded={isHistoryOpen}
              onClick={() => setIsHistoryOpen(true)}
            >
              <HistoryIcon className="hidden h-4 w-4 sm:block" />
              <span aria-hidden="true" className="inline">
                History
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewChat}
              aria-label="New chat"
            >
              <Plus className="hidden h-4 w-4 sm:block" />
              <span className="inline">New chat</span>
            </Button>
            {conversationId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Archive chat"
                onClick={archiveCurrentChat}
                disabled={isArchiving}
              >
                {isArchiving ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Archive className="hidden h-4 w-4 sm:block" />
                )}
                <span className="inline">Archive</span>
              </Button>
            )}
          </div>
        </header>

        {error && (
          <div className="shrink-0 px-3 pt-3 sm:px-5">
            <Alert variant="destructive">
              <AlertTitle>Copilot unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-hidden">
          <SreAssistantUiThread
            key={threadKey}
            conversationId={conversationId}
            incidentId={incidentId}
            initialMessages={activeMessages}
            onConversationResolved={handleConversationResolved}
            onClearError={() => setError(null)}
            onError={(message) => {
              setError(message);
              toast.error(message);
            }}
          />
        </section>
        <footer className="shrink-0 border-t px-3 py-2 text-center text-xs text-muted-foreground sm:px-5">
          <Link
            href={incidentId ? `/incidents/${incidentId}` : "/incidents"}
            className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {incidentId
              ? "Back to incident"
              : "Open an incident to ask about its evidence"}
          </Link>
        </footer>
      </main>
    </div>
  );
}
