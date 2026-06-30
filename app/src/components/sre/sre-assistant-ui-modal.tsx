"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bot, ExternalLink, MessageCircle } from "lucide-react";
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

export function SreAssistantUiModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SreStandaloneChatHistory["messages"]>([]);
  const [threadKey, setThreadKey] = useState("floating-new");

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setThreadKey(`floating-new-${Date.now()}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          aria-label="Open AISRE Copilot"
          className={cn(
            "fixed right-5 z-40 h-12 w-12 rounded-full shadow-lg",
            pathname?.startsWith("/copilot") ? "bottom-24" : "bottom-5"
          )}
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bottom-4 right-4 left-auto top-auto grid h-[min(760px,calc(100svh-2rem))] w-[min(460px,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:rounded-xl">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm">AISRE Copilot</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  Read-only triage and verification planning.
                </DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={startNewChat}>
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
        <div className="min-h-0 flex-1 overflow-hidden">
          <SreAssistantUiThread
            key={threadKey}
            conversationId={conversationId}
            initialMessages={messages}
            onConversationResolved={(input) => {
              setConversationId(input.conversationId);
              setMessages(input.messages);
              setThreadKey(input.conversationId);
            }}
            onError={(message) => toast.error(message)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
