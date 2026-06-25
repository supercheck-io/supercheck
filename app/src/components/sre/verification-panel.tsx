import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, SearchCheck, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const VERIFICATION_KEYWORDS = /\b(verify|verification|confirm|validate|check|monitor|observe|watch|compare)\b/i;
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]"],
  [/\b(token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;"']+/gi, "$1=[REDACTED]"],
];

function sanitizeTaskLine(value: string) {
  const withoutMarkdown = value
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
  const redacted = REDACTION_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), withoutMarkdown);
  return redacted.length > 180 ? `${redacted.slice(0, 177)}...` : redacted;
}

export function extractSreVerificationTasks(content: string | null | undefined) {
  if (!content) {
    return [];
  }

  const tasks = new Set<string>();
  for (const rawLine of content.replace(/\\n/g, "\n").split("\n")) {
    const line = sanitizeTaskLine(rawLine);
    if (line.length < 8 || !VERIFICATION_KEYWORDS.test(line)) {
      continue;
    }

    const task = line.replace(/^verification plan\s*[:：]\s*/i, "").trim();
    if (!task) {
      continue;
    }

    tasks.add(task);
    if (tasks.size >= 5) {
      break;
    }
  }

  return Array.from(tasks);
}

function ReadinessRow({
  status,
  title,
  description,
}: {
  status: "ready" | "attention";
  title: string;
  description: string;
}) {
  const Icon = status === "ready" ? CheckCircle2 : AlertTriangle;

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/10 p-3">
      <Icon className={status === "ready" ? "mt-0.5 h-4 w-4 text-emerald-600" : "mt-0.5 h-4 w-4 text-amber-600"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          <Badge variant={status === "ready" ? "secondary" : "outline"}>{status === "ready" ? "ready" : "attention"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

type SreVerificationPanelProps = {
  evidenceCount: number;
  hasPrimaryService: boolean;
  useLiveConnectors: boolean;
  latestAssistantContent?: string | null;
};

export function SreVerificationPanel({
  evidenceCount,
  hasPrimaryService,
  useLiveConnectors,
  latestAssistantContent,
}: SreVerificationPanelProps) {
  const tasks = useMemo(() => extractSreVerificationTasks(latestAssistantContent), [latestAssistantContent]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Verification readiness
        </CardTitle>
        <CardDescription>Read-only checks before a human applies or validates any production fix.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ReadinessRow
          status={evidenceCount > 0 ? "ready" : "attention"}
          title="Stored evidence"
          description={
            evidenceCount > 0
              ? `${evidenceCount} stored evidence item${evidenceCount === 1 ? "" : "s"} available for citation checks.`
              : "Generate an evidence brief or gather connector evidence before trusting root-cause claims."
          }
        />
        <ReadinessRow
          status={hasPrimaryService ? "ready" : "attention"}
          title="Service scope"
          description={
            hasPrimaryService
              ? "Incident has a primary service for scoped investigation and connector searches."
              : "Map a primary service before using live connector investigation."
          }
        />
        <ReadinessRow
          status={!useLiveConnectors || hasPrimaryService ? "ready" : "attention"}
          title="Connector verification"
          description={
            useLiveConnectors
              ? "Live connector checks are requested and remain read-only under API/RBAC controls."
              : "Live connectors are optional; stored evidence can still support a bounded investigation."
          }
        />

        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2">
            <SearchCheck className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Suggested verification checks</p>
          </div>
          {tasks.length > 0 ? (
            <ul className="mt-3 space-y-2" role="list">
              {tasks.map((task, index) => (
                <li key={`${index}-${task.slice(0, 32)}`} className="rounded border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {task}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Ask SRE AI for a verification plan after evidence is gathered. SuperCheck will not apply remediation automatically.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
