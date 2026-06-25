"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Bot, FileUp, Loader2, MessageSquare, Plus, Radar, SearchCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { archiveSreIncidentChatConversation, type SreIncidentChatHistory } from "@/actions/sre-incidents";
import { SreChatInput } from "@/components/sre/chat-input";
import {
  SreChatMessageList,
  type SreChatMessage,
  type SreEvidenceCitationReference,
} from "@/components/sre/chat-message-list";
import {
  SreInvestigationProgressCard,
  summarizeSreAgentProgressEvent,
  type SreInvestigationProgressEvent,
} from "@/components/sre/investigation-progress-card";
import { parseSreSseEvents, sreSseDataRecord } from "@/components/sre/sre-sse-client";
import { SreVerificationPanel } from "@/components/sre/verification-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type SreInvestigationPanelProps = {
  incidentId: string;
  hasPrimaryService: boolean;
  evidenceReferences?: SreEvidenceCitationReference[];
  initialConversationId?: string | null;
  initialMessages?: SreChatMessage[];
  chatHistories?: SreIncidentChatHistory[];
};

type SreUploadedFileAttachment = {
  type: "file";
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageBucket: string;
  storagePath: string;
  incidentId: string;
};

function getLatestAssistantContent(messages: SreChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index].content;
    }
  }

  return null;
}

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  evidenceReferences = [],
  initialConversationId = null,
  initialMessages = [],
  chatHistories = [],
}: SreInvestigationPanelProps) {
  const router = useRouter();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const [isInvestigating, startInvestigationTransition] = useTransition();
  const [question, setQuestion] = useState("What is the most likely root cause and what evidence supports it?");
  const [contextAttachment, setContextAttachment] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<SreChatMessage[]>(initialMessages);
  const [progressEvents, setProgressEvents] = useState<SreInvestigationProgressEvent[]>([]);
  const [isChatPending, setIsChatPending] = useState(false);
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null);
  const [isArchivingChat, startArchiveChatTransition] = useTransition();
  const [chatError, setChatError] = useState<string | null>(null);
  const latestAssistantContent = getLatestAssistantContent(messages);

  const selectConversation = (selectedConversationId: string) => {
    if (selectedConversationId === "new") {
      startNewConversation();
      return;
    }

    const selected = chatHistories.find((history) => history.conversationId === selectedConversationId);
    if (!selected) {
      return;
    }

    setConversationId(selected.conversationId);
    setMessages(selected.messages);
    setProgressEvents([]);
    setChatError(null);
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setProgressEvents([]);
    setChatError(null);
  };

  const archiveCurrentConversation = () => {
    if (!conversationId || isArchivingChat) {
      return;
    }

    startArchiveChatTransition(async () => {
      const result = await archiveSreIncidentChatConversation({ incidentId, conversationId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("SRE chat archived");
      startNewConversation();
      router.refresh();
    });
  };

  const uploadSelectedFileAttachment = async (): Promise<SreUploadedFileAttachment | null> => {
    if (!selectedAttachmentFile) {
      return null;
    }

    const formData = new FormData();
    formData.append("incidentId", incidentId);
    formData.append("file", selectedAttachmentFile);

    const response = await fetch("/api/sre/chat/attachments", {
      method: "POST",
      body: formData,
    });
    const body = await response.json().catch(() => null) as { attachment?: SreUploadedFileAttachment; error?: string } | null;

    if (!response.ok || !body?.attachment) {
      throw new Error(body?.error ?? "SRE attachment upload failed");
    }

    return body.attachment;
  };

  const runInvestigation = () => {
    startInvestigationTransition(async () => {
      const response = await fetch("/api/sre/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId, useLiveConnectors }),
      });
      const body = await response.json().catch(() => null) as { error?: string; summary?: string } | null;

      if (!response.ok) {
        toast.error(body?.error ?? "SRE investigation failed");
        return;
      }

      toast.success("SRE investigation completed", {
        description: body?.summary ? body.summary.slice(0, 120) : "Incident summary updated",
      });
      router.refresh();
    });
  };

  const submitChat = async () => {
    const trimmed = question.trim();
    if (!trimmed || isChatPending) {
      return;
    }

    setIsChatPending(true);
    setChatError(null);
    setProgressEvents([]);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: trimmed }]);

    try {
      const uploadedFileAttachment = await uploadSelectedFileAttachment();
      const attachments = [
        ...(contextAttachment.trim()
          ? [{ type: "text" as const, title: "Responder context", content: contextAttachment.trim() }]
          : []),
        ...(uploadedFileAttachment ? [uploadedFileAttachment] : []),
      ];

      const response = await fetch("/api/sre/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          incidentId,
          message: trimmed,
          title: "Incident investigation",
          attachments,
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "SRE AI chat failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
            setConversationId(data.id);
          }

          if (event.event === "message" && data.role === "assistant" && typeof data.content === "string") {
            const assistantContent = data.content;
            const assistantMessageId = typeof data.id === "string" ? data.id : `assistant-${Date.now()}`;
            const assistantModelId = typeof data.modelId === "string" ? data.modelId : null;

            setMessages((current) => [
              ...current,
              {
                id: assistantMessageId,
                role: "assistant",
                content: assistantContent,
                modelId: assistantModelId,
              },
            ]);
          }

          if (event.event === "error" && typeof data.message === "string") {
            throw new Error(data.message);
          }
        }
      }
      setQuestion("");
      setContextAttachment("");
      setSelectedAttachmentFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SRE AI chat failed";
      setChatError(message);
      toast.error(message);
    } finally {
      setIsChatPending(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-3xl">
      <CardHeader className="border-b bg-[radial-gradient(circle_at_top_left,_hsl(var(--primary)/0.12),_transparent_38%)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Bot className="h-5 w-5" />
              AI investigation workspace
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl">
              Evidence-scoped SRE agent chat with read-only investigation runs, safe tool progress, context attachments, and verification planning.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5 rounded-full">
              <Radar className="h-3.5 w-3.5" />
              Incident scoped
            </Badge>
            <Badge variant="outline" className="gap-1.5 rounded-full">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-2xl border bg-muted/20 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Dedicated investigation run</p>
              <p className="text-sm text-muted-foreground">
                Produces a cited root-cause summary and timeline event. The API is disabled until rollout flags are enabled.
              </p>
            </div>
            <Button onClick={runInvestigation} disabled={isInvestigating}>
              {isInvestigating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SearchCheck className="mr-2 h-4 w-4" />}
              Run investigation
            </Button>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-2xl border bg-background p-3">
            <Switch
              id="live-connectors"
              checked={useLiveConnectors}
              disabled={!hasPrimaryService || isInvestigating}
              onCheckedChange={setUseLiveConnectors}
            />
            <div className="space-y-1">
              <Label htmlFor="live-connectors">Use live connector tools</Label>
              <p className="text-xs text-muted-foreground">
                Requires connector investigation permission and an incident primary service. Connector execution remains read-only.
              </p>
              {!hasPrimaryService && <Badge variant="outline">Primary service required</Badge>}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Ask SRE AI about this incident</p>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <Label className="text-xs text-muted-foreground">Conversation</Label>
              {chatHistories.length > 0 ? (
                <Select value={conversationId ?? "new"} onValueChange={selectConversation}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select SRE chat" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New incident chat</SelectItem>
                    {chatHistories.map((history) => (
                      <SelectItem key={history.conversationId} value={history.conversationId}>
                        {history.title ?? "Incident investigation"} · {history.messages.length} messages
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No saved incident chat yet.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={startNewConversation} disabled={isChatPending}>
                <Plus className="h-4 w-4" />
                New chat
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={archiveCurrentConversation}
                disabled={!conversationId || isArchivingChat || isChatPending}
              >
                {isArchivingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                Archive
              </Button>
            </div>
          </div>
          {chatError && (
            <Alert variant="destructive">
              <AlertTitle>Chat unavailable</AlertTitle>
              <AlertDescription>{chatError}</AlertDescription>
            </Alert>
          )}
          <SreChatMessageList
            messages={messages}
            evidenceReferences={evidenceReferences}
            emptyTitle="No incident chat yet"
            emptyDescription="Ask a question to start an incident-scoped SRE conversation."
            className="h-[460px] min-h-[360px]"
          />
          <SreInvestigationProgressCard events={progressEvents} />
          <SreVerificationPanel
            evidenceCount={evidenceReferences.length}
            hasPrimaryService={hasPrimaryService}
            useLiveConnectors={useLiveConnectors}
            latestAssistantContent={latestAssistantContent}
          />
          <div className="space-y-2 rounded-2xl border bg-muted/10 p-3">
            <Label htmlFor="sre-chat-context-attachment">Optional context attachment</Label>
            <Textarea
              id="sre-chat-context-attachment"
              value={contextAttachment}
              onChange={(event) => setContextAttachment(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Paste a short read-only context note, command output excerpt, or responder observation. Secrets are redacted server-side before storage/prompt use."
              disabled={isChatPending}
            />
            <p className="text-xs text-muted-foreground">
              Text notes are limited to 2,000 characters. File uploads are stored separately and passed to the AI as metadata only.
            </p>
            <div className="rounded-2xl border bg-background p-3">
              <Label htmlFor="sre-chat-file-attachment" className="flex items-center gap-2 text-sm">
                <FileUp className="h-4 w-4" />
                Optional file attachment
              </Label>
              <input
                id="sre-chat-file-attachment"
                type="file"
                accept=".txt,.md,.json,.csv,image/png,image/jpeg,image/webp"
                className="mt-2 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
                disabled={isChatPending}
                onChange={(event) => setSelectedAttachmentFile(event.target.files?.[0] ?? null)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Max 2MB. Allowed: TXT, Markdown, JSON, CSV, PNG, JPEG, WebP. The AI receives metadata only, not file bytes.
              </p>
              {selectedAttachmentFile && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Selected: {selectedAttachmentFile.name} ({Math.ceil(selectedAttachmentFile.size / 1024)}KB)
                </p>
              )}
            </div>
          </div>
          <SreChatInput
            value={question}
            onChange={setQuestion}
            onSubmit={submitChat}
            isPending={isChatPending}
            placeholder="Ask for evidence-backed root cause, missing evidence, or verification steps..."
            footer="Responses are saved to an incident-scoped SRE conversation."
            submitLabel="Send"
          />
        </div>
      </CardContent>
    </Card>
  );
}
