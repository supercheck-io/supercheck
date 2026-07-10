"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Bot, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { SreAssistantUiThread } from "@/components/sre/sre-assistant-ui-thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const INCIDENT_PATH_PATTERN =
  /^\/incidents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function SreAssistantUiModal() {
  const pathname = usePathname();
  const incidentId = useMemo(() => {
    const match = pathname?.match(INCIDENT_PATH_PATTERN);
    return match?.[1] ?? null;
  }, [pathname]);
  const activeContextKey = incidentId ?? "standalone";
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    SreStandaloneChatHistory["messages"]
  >([]);
  const [threadKey, setThreadKey] = useState("floating-new");
  const [conversationContextKey, setConversationContextKey] =
    useState(activeContextKey);

  const isCurrentContext = conversationContextKey === activeContextKey;
  const activeConversationId = isCurrentContext ? conversationId : null;
  const activeMessages = isCurrentContext ? messages : [];
  const activeThreadKey = isCurrentContext
    ? threadKey
    : `floating-context-${activeContextKey}`;

  const startNewChat = () => {
    setConversationContextKey(activeContextKey);
    setConversationId(null);
    setMessages([]);
    setThreadKey(`floating-new-${activeContextKey}-${Date.now()}`);
  };

  if (pathname?.startsWith("/copilot")) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        <Button
          type="button"
          aria-label="Open Copilot"
          aria-expanded={open}
          title="Open AI SRE Copilot"
          className={cn(
            "fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center gap-2 rounded-full border border-primary/20 bg-primary p-0 text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] sm:w-auto sm:px-4",
          )}
        >
          <Bot className="h-5 w-5" />
          <span className="hidden text-sm font-medium sm:inline">Copilot</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        hideOverlay
        className="bottom-0 right-0 left-auto top-auto grid h-[100svh] w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:bottom-4 sm:right-4 sm:h-[min(740px,calc(100svh-2rem))] sm:w-[min(820px,calc(100vw-2rem))] sm:rounded-xl [&>button]:right-4 [&>button]:top-4"
      >
        <DialogHeader className="w-full min-w-0 border-b px-4 py-3 pr-16">
          <div className="flex w-full min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm">Copilot</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  {incidentId
                    ? "Read-only incident evidence and verification."
                    : "Read-only incident triage and verification planning."}
                </DialogDescription>
              </div>
            </div>
            <div className="mr-8 flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startNewChat}
              >
                New
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/copilot">
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          <SreAssistantUiThread
            key={activeThreadKey}
            conversationId={activeConversationId}
            incidentId={incidentId}
            initialMessages={activeMessages}
            onConversationResolved={(input) => {
              setConversationContextKey(activeContextKey);
              setConversationId(input.conversationId);
              setMessages(input.messages);
              setThreadKey(input.conversationId);
            }}
            onClearError={() => toast.dismiss()}
            onError={(message) => toast.error(message)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
