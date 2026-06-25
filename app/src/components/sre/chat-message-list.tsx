import type { ReactNode, Ref } from "react";
import { Bot, MessageSquare, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SreChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelId?: string | null;
};

export type SreEvidenceCitationReference = {
  id: string;
  title: string;
  evidenceType: string;
};

type SreChatMessageListProps = {
  messages: SreChatMessage[];
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon?: ReactNode;
  className?: string;
  evidenceReferences?: SreEvidenceCitationReference[];
  bottomRef?: Ref<HTMLDivElement>;
};

const PREFIXED_EVIDENCE_ID_PATTERN = /\b(?:ev|evidence|connector)[_-][a-zA-Z0-9][a-zA-Z0-9_-]{2,96}\b/g;
const LABELED_UUID_EVIDENCE_PATTERN = /\b(?:evidence|citation|cited evidence)(?:\s+id[s]?)?\s*[:#-]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

export function extractSreEvidenceCitations(content: string) {
  const citations = new Set<string>();

  for (const match of content.matchAll(PREFIXED_EVIDENCE_ID_PATTERN)) {
    citations.add(match[0]);
  }

  for (const match of content.matchAll(LABELED_UUID_EVIDENCE_PATTERN)) {
    if (match[1]) {
      citations.add(match[1]);
    }
  }

  return Array.from(citations).slice(0, 12);
}

export function SreChatMessageList({
  messages,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  className = "min-h-[420px]",
  evidenceReferences = [],
  bottomRef,
}: SreChatMessageListProps) {
  const evidenceById = new Map(evidenceReferences.map((evidence) => [evidence.id, evidence]));

  return (
    <div className={cn("overflow-y-auto rounded-2xl border bg-background/80 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      <div className="min-h-[inherit] p-3 sm:p-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-[inherit] max-w-2xl flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-background shadow-sm">
              {emptyIcon ?? <MessageSquare className="h-7 w-7 text-muted-foreground" />}
            </div>
            <h3 className="mt-4 text-base font-semibold">{emptyTitle}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{emptyDescription}</p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-3">
            {messages.map((message) => {
              const evidenceCitations = message.role === "assistant" ? extractSreEvidenceCitations(message.content) : [];
              const isAssistant = message.role === "assistant";

              return (
                <div key={message.id} className={cn("flex gap-3", !isAssistant && "justify-end")}>
                  {isAssistant && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "min-w-0 px-4 py-3 text-sm leading-6",
                      isAssistant
                        ? "flex-1 text-foreground"
                        : "max-w-[82%] rounded-2xl rounded-tr-md border bg-muted/70 text-foreground shadow-sm sm:max-w-[68%]"
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={isAssistant ? "secondary" : "outline"}>{isAssistant ? "SRE AI" : "You"}</Badge>
                      {message.modelId && <span className="text-xs text-muted-foreground">{message.modelId}</span>}
                    </div>
                    <p className="whitespace-pre-line">{message.content}</p>
                    {evidenceCitations.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                        <span className="text-xs font-medium text-muted-foreground">Cited evidence</span>
                        {evidenceCitations.map((citation) => {
                          const evidence = evidenceById.get(citation);
                          const chip = (
                            <Badge variant={evidence ? "secondary" : "outline"} className="font-mono text-[11px]">
                              {citation}
                            </Badge>
                          );

                          if (!evidence) {
                            return <span key={citation}>{chip}</span>;
                          }

                          return (
                            <a
                              key={citation}
                              href={`#sre-evidence-${citation}`}
                              title={`${evidence.title} (${evidence.evidenceType})`}
                              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {chip}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {!isAssistant && (
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background shadow-sm">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
