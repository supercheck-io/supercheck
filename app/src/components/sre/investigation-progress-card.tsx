import { Activity, AlertTriangle, CheckCircle2, Clock, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type SreInvestigationToolActivity = {
  id: string;
  name: string;
  status: "called" | "completed";
  summary?: {
    itemCount: number;
    message?: string | null;
    privateAgentJobId?: string | null;
    evidence?: Array<{ id: string; title: string; evidenceType: string; sourceType: string }>;
    connectors?: Array<{ id: string; name: string; type: string; executionMode: string }>;
  };
};

export type SreInvestigationProgressEvent = {
  id: string;
  kind: "step" | "fallback" | "done";
  title: string;
  description?: string;
  status: "running" | "success" | "warning";
  elapsedMs?: number;
  tools?: SreInvestigationToolActivity[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function truncate(value: string, maxLength = 180) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function getToolCallCount(eventPayload: Record<string, unknown>) {
  const event = asRecord(eventPayload.event);
  const toolCalls = event.toolCalls;
  return Array.isArray(toolCalls) ? toolCalls.length : 0;
}

function safeToolName(value: unknown) {
  if (typeof value !== "string") {
    return "read-only tool";
  }

  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(trimmed)) {
    return "read-only tool";
  }

  return trimmed;
}

function getToolActivities(eventPayload: Record<string, unknown>): SreInvestigationToolActivity[] {
  const event = asRecord(eventPayload.event);
  const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
  const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
  const resultsByToolCallId = new Map(
    toolResults.flatMap((toolResult) => {
      const record = asRecord(toolResult);
      return typeof record.toolCallId === "string" ? [[record.toolCallId, record.summary]] : [];
    }),
  );

  return toolCalls.slice(0, 10).map((toolCall, index) => {
    const record = asRecord(toolCall);
    const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : `tool-call-${index}`;
    const toolName = safeToolName(record.toolName ?? record.name);

    return {
      id: toolCallId,
      name: toolName,
      status: resultsByToolCallId.has(toolCallId) ? "completed" : "called",
      summary: normalizeToolResultSummary(resultsByToolCallId.get(toolCallId)),
    };
  });
}

function normalizeToolResultSummary(value: unknown): SreInvestigationToolActivity["summary"] {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const evidence = Array.isArray(record.evidence)
    ? record.evidence.slice(0, 3).map((item) => {
        const evidenceItem = asRecord(item);
        return {
          id: safeToolName(evidenceItem.id),
          title: typeof evidenceItem.title === "string" ? truncate(evidenceItem.title, 100) : "Untitled evidence",
          evidenceType: safeToolName(evidenceItem.evidenceType),
          sourceType: safeToolName(evidenceItem.sourceType),
        };
      })
    : [];
  const connectors = Array.isArray(record.connectors)
    ? record.connectors.slice(0, 3).map((item) => {
        const connector = asRecord(item);
        return {
          id: safeToolName(connector.id),
          name: typeof connector.name === "string" ? truncate(connector.name, 100) : "Connector",
          type: safeToolName(connector.type),
          executionMode: safeToolName(connector.executionMode),
        };
      })
    : [];

  return {
    itemCount: typeof record.itemCount === "number" ? record.itemCount : 0,
    message: typeof record.message === "string" ? truncate(record.message, 140) : null,
    privateAgentJobId: typeof record.privateAgentJobId === "string" ? safeToolName(record.privateAgentJobId) : null,
    evidence,
    connectors,
  };
}

export function summarizeSreAgentProgressEvent(eventName: string, payload: unknown): Omit<SreInvestigationProgressEvent, "id"> | null {
  const data = asRecord(payload);

  if (eventName === "agent.step") {
    const stepIndex = typeof data.stepIndex === "number" ? data.stepIndex : null;
    const elapsedMs = typeof data.elapsedMs === "number" ? data.elapsedMs : undefined;
    const modelId = typeof data.modelId === "string" ? data.modelId : null;
    const toolCallCount = getToolCallCount(data);
    const tools = getToolActivities(data);
    const toolSummary = toolCallCount > 0 ? `${toolCallCount} read-only tool call${toolCallCount === 1 ? "" : "s"}` : "model reasoning step";

    return {
      kind: "step",
      title: stepIndex ? `Agent step ${stepIndex}` : "Agent step",
      description: truncate([toolSummary, modelId ? `model: ${modelId}` : null].filter(Boolean).join(" · ")),
      status: "running",
      elapsedMs,
      tools,
    };
  }

  if (eventName === "agent.fallback") {
    const reason = typeof data.reason === "string" ? data.reason : "AI provider unavailable";
    return {
      kind: "fallback",
      title: "Fallback response used",
      description: truncate(reason),
      status: "warning",
    };
  }

  if (eventName === "done") {
    return {
      kind: "done",
      title: "Copilot response complete",
      description: "The assistant response was saved to the conversation.",
      status: "success",
    };
  }

  return null;
}

function formatElapsed(value?: number) {
  if (typeof value !== "number") {
    return null;
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: SreInvestigationProgressEvent["status"] }) {
  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }

  if (status === "warning") {
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }

  return <Activity className="h-4 w-4 text-blue-600" />;
}

type SreInvestigationProgressCardProps = {
  events: SreInvestigationProgressEvent[];
};

export function SreInvestigationProgressCard({ events }: SreInvestigationProgressCardProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Investigation progress
        </CardTitle>
        <CardDescription>Read-only agent steps streamed by the current conversation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.slice(-8).map((event) => (
          <div key={event.id} className="flex items-start gap-3 rounded-md border bg-muted/10 p-3">
            <StatusIcon status={event.status} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{event.title}</p>
                <Badge variant="outline" className="capitalize">{event.kind}</Badge>
                {formatElapsed(event.elapsedMs) && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatElapsed(event.elapsedMs)}
                  </span>
                )}
              </div>
              {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
              {event.tools && event.tools.length > 0 && (
                <details className="group rounded-md border bg-background/60 px-3 py-2 text-xs">
                  <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground">
                    <Wrench className="h-3.5 w-3.5" />
                    Read-only tool activity
                  </summary>
                  <div className="mt-2 space-y-2">
                    {event.tools.map((tool) => (
                      <div key={tool.id} className="flex flex-wrap items-center gap-2 rounded border bg-muted/20 px-2 py-1.5">
                        <span className="font-mono text-[11px] text-foreground">{tool.name}</span>
                        <Badge variant="outline" className="capitalize">{tool.status}</Badge>
                        {tool.summary && <span className="text-muted-foreground">{tool.summary.itemCount} safe result item{tool.summary.itemCount === 1 ? "" : "s"}</span>}
                        {tool.summary?.privateAgentJobId && <Badge variant="secondary">job {tool.summary.privateAgentJobId}</Badge>}
                        {tool.summary?.message && <span className="basis-full text-muted-foreground">{tool.summary.message}</span>}
                        {tool.summary?.evidence?.map((item) => (
                          <span key={`${tool.id}-${item.id}`} className="basis-full rounded bg-background px-2 py-1 text-muted-foreground">
                            Evidence {item.id}: {item.title} ({item.evidenceType}/{item.sourceType})
                          </span>
                        ))}
                        {tool.summary?.connectors?.map((item) => (
                          <span key={`${tool.id}-${item.id}`} className="basis-full rounded bg-background px-2 py-1 text-muted-foreground">
                            Connector {item.name} ({item.type}, {item.executionMode})
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
