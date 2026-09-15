"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Archive,
  Bot,
  Clock3,
  History as HistoryIcon,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  archiveSreStandaloneChat,
  type SreStandaloneChatHistory,
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
  initialHistories?: SreStandaloneChatHistory[];
  loadError?: string | null;
  onHistoriesChange?: (histories: SreStandaloneChatHistory[]) => void;
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
  loadError = null,
  onHistoriesChange,
}: SreAiConsoleProps) {
  const [histories, setHistories] = useState(initialHistories);
  const [historyQuery, setHistoryQuery] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    initialHistories[0]?.conversationId ?? null,
  );
  const [activeMessages, setActiveMessages] = useState<
    SreStandaloneChatHistory["messages"]
  >(initialHistories[0]?.messages ?? []);
  const [error, setError] = useState<string | null>(loadError);
  const [threadKey, setThreadKey] = useState(
    initialHistories[0]?.conversationId ?? "new",
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

  const selectHistory = (history: SreStandaloneChatHistory) => {
    setIsHistoryOpen(false);
    setConversationId(history.conversationId);
    setActiveMessages(history.messages);
    setError(null);
    setThreadKey(history.conversationId);
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

      setHistories((current) =>
        current.filter((history) => history.conversationId !== conversationId),
      );
      startNewChat();
      toast.success("Copilot session archived");
    });
  };

  const handleConversationResolved = (input: {
    conversationId: string;
    messages: SreStandaloneChatHistory["messages"];
    title: string;
  }) => {
    setConversationId(input.conversationId);
    setActiveMessages(input.messages);
    setThreadKey(input.conversationId);
    setHistories((current) => {
      const withoutActive = current.filter(
        (history) => history.conversationId !== input.conversationId,
      );
      return [
        {
          conversationId: input.conversationId,
          title: input.title,
          updatedAt: new Date().toISOString(),
          messages: input.messages,
        },
        ...withoutActive,
      ];
    });
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <SheetContent
          side="left"
          className="w-[min(22rem,88vw)] gap-0 p-0 md:hidden"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Chat history</SheetTitle>
            <SheetDescription>Your saved Copilot chats</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 border-b p-3">
            <Button
              type="button"
              className="w-full justify-start"
              onClick={startNewChat}
            >
              <Plus className="h-4 w-4" />
              New chat
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
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
                        <Clock3 className="h-3 w-3" />
                        <time dateTime={history.updatedAt}>
                          {formatHistoryDate(history.updatedAt)}
                        </time>{" "}
                        · {history.messages.length} messages
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
              Open an incident to review stored evidence.
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <aside className="hidden w-72 shrink-0 border-r bg-muted/10 md:flex md:flex-col">
        <div className="flex flex-col gap-3 border-b p-3">
          <div>
            <p className="text-sm font-medium">Chat history</p>
            <p className="text-xs text-muted-foreground">
              Your saved Copilot chats
            </p>
          </div>
          <Button
            type="button"
            className="w-full justify-start"
            onClick={startNewChat}
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Search history"
              className="h-9 border-0 bg-muted/40 pl-8 shadow-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                      "w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-background shadow-sm ring-1 ring-border",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {history.title ?? "Copilot chat"}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <time dateTime={history.updatedAt}>
                        {formatHistoryDate(history.updatedAt)}
                      </time>{" "}
                      · {history.messages.length} messages
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
            Open an incident to review stored evidence.
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
              <h1 className="truncate text-sm font-semibold">Copilot</h1>
              <p className="truncate text-xs text-muted-foreground">
                Read-only incident triage and evidence review.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="md:hidden"
              aria-label="History"
              aria-expanded={isHistoryOpen}
              onClick={() => setIsHistoryOpen(true)}
            >
              <HistoryIcon className="h-4 w-4" />
              <span aria-hidden="true" className="hidden sm:inline">
                History
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewChat}
              aria-label="New"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </Button>
            {conversationId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={archiveCurrentChat}
                disabled={isArchiving}
              >
                {isArchiving ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Archive</span>
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
            initialMessages={activeMessages}
            onConversationResolved={handleConversationResolved}
            onClearError={() => setError(null)}
            onError={(message) => {
              setError(message);
              toast.error(message);
            }}
          />
        </section>
      </main>
    </div>
  );
}
