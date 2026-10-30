"use client";

import { useState } from "react";
import { FileText, Siren } from "lucide-react";

import { GenerateEvidenceBriefButton } from "@/components/sre/incidents/generate-evidence-brief-button";
import {
  SreIncidentBriefReport,
  SreIncidentBriefReportActions,
} from "@/components/sre/incidents/sre-incident-brief-report";
import { confidenceLabel } from "@/components/sre/incidents/incident-ai-summary-card";
import { TableBadge } from "@/components/ui/table-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SreIncidentBriefPanelProps = {
  incidentId: string;
  incidentNumber: number;
  incidentTitle: string;
  initialSummary: string | null;
  initialProvider: string | null;
  initialConfidenceScore: string | null;
  hasBrief: boolean;
  canGenerate?: boolean;
  evidenceCount?: number | null;
  totalEvidenceCount?: number;
};

export function SreIncidentBriefPanel({
  incidentId,
  incidentNumber,
  incidentTitle,
  initialSummary,
  initialProvider,
  initialConfidenceScore,
  hasBrief,
  canGenerate = false,
  evidenceCount = null,
  totalEvidenceCount = 0,
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
              A shareable summary of the evidence used for this brief, with findings and gaps. Regenerate after collecting new evidence.
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
            {canGenerate && <GenerateEvidenceBriefButton
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
            />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        {summary || isStreaming ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            {evidenceCount !== null && (
              <p className="text-sm text-muted-foreground">
                This saved brief used {evidenceCount} evidence item{evidenceCount === 1 ? "" : "s"}. The incident currently has {totalEvidenceCount} saved item{totalEvidenceCount === 1 ? "" : "s"}; evidence outside the incident time window is excluded. Regenerate to include newly collected evidence within that window.
              </p>
            )}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {confidenceScore != null && (
                <TableBadge tone={confidenceLabel(confidenceScore).tone}>
                  Confidence: {confidenceLabel(confidenceScore).label}
                </TableBadge>
              )}
              {provider && (
                <TableBadge tone={provider === "ai" ? "success" : "warning"}>
                  {provider === "ai" ? "AI generated" : "Fallback brief"}
                </TableBadge>
              )}
              {isStreaming && <TableBadge tone="info">Streaming</TableBadge>}
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
