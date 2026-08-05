"use client";

import { useState } from "react";
import { FileText, Siren } from "lucide-react";

import { GenerateEvidenceBriefButton } from "@/components/sre/incidents/generate-evidence-brief-button";
import {
  SreIncidentBriefReport,
  SreIncidentBriefReportActions,
} from "@/components/sre/incidents/sre-incident-brief-report";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SreIncidentBriefPanelProps = {
  incidentId: string;
  incidentNumber: number;
  incidentTitle: string;
  initialSummary: string | null;
  initialProvider: string | null;
  initialConfidenceScore: string | null;
  hasBrief: boolean;
};

const providerBadgeClasses: Record<string, string> = {
  ai: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  fallback:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
};

function confidenceBadgeClass(value: string | null) {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300";
  }
  if (score >= 0.75) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (score >= 0.45) {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
}

export function SreIncidentBriefPanel({
  incidentId,
  incidentNumber,
  incidentTitle,
  initialSummary,
  initialProvider,
  initialConfidenceScore,
  hasBrief,
}: SreIncidentBriefPanelProps) {
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [provider, setProvider] = useState(initialProvider);
  const [confidenceScore, setConfidenceScore] = useState(
    initialConfidenceScore,
  );
  const [isStreaming, setIsStreaming] = useState(false);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Siren className="h-5 w-5" />
              Evidence brief
            </CardTitle>
            <CardDescription>
              Streamed Markdown grounded in cited incident evidence. This is
              separate from the saved investigation report snapshot.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary && (
              <SreIncidentBriefReportActions
                incidentNumber={incidentNumber}
                incidentTitle={incidentTitle}
                content={summary}
                disabled={isStreaming}
              />
            )}
            <GenerateEvidenceBriefButton
              incidentId={incidentId}
              hasBrief={hasBrief || Boolean(summary)}
              onStreamStart={() => {
                setSummary("");
                setProvider(null);
                setConfidenceScore(null);
                setIsStreaming(true);
              }}
              onStreamContent={(chunk) => {
                setSummary((current) => current + chunk);
              }}
              onStreamDone={(result) => {
                if (result.brief) {
                  setSummary(result.brief.summary);
                  setProvider(result.brief.provider);
                  setConfidenceScore(String(result.brief.confidenceScore));
                }
                setIsStreaming(false);
              }}
              onStreamError={() => {
                setIsStreaming(false);
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        {summary || isStreaming ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {confidenceScore != null && (
                <Badge
                  variant="outline"
                  className={confidenceBadgeClass(confidenceScore)}
                >
                  Confidence {Math.round(Number(confidenceScore) * 100)}%
                </Badge>
              )}
              {provider && (
                <Badge
                  variant="outline"
                  className={cn(
                    "capitalize",
                    providerBadgeClasses[provider] ??
                      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
                  )}
                >
                  {provider === "ai" ? "AI generated" : "Fallback brief"}
                </Badge>
              )}
              {isStreaming && (
                <Badge
                  variant="outline"
                  className="border-cyan-200 bg-cyan-50 text-cyan-700 shadow-sm shadow-cyan-500/10 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300"
                >
                  Streaming
                </Badge>
              )}
            </div>
            <SreIncidentBriefReport
              content={summary}
              isStreaming={isStreaming}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">
              No evidence brief generated
            </h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Generate a brief when you need native evidence citations for this
              incident.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
