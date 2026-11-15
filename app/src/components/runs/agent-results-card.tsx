import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { typeText } from "@/lib/type-tones";

export type AgentRunSummary = {
  tests: Array<{
    testId?: string;
    title: string;
    attempts: number;
    passed: number;
    passRate: number;
    totalTokens?: number;
    judgeTokens?: number;
    toolNames?: string[];
    durationMs?: number;
    slowestMs?: number;
    failures?: Array<{ attempt: number; message: string }>;
  }>;
};

const seconds = (ms?: number) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "-");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Text-only summary of agent tests (runs.metadata.agent). Renders nothing when the run has none. */
export function AgentResultsCard({ agent, loading = false, error = false }: { agent?: AgentRunSummary | null; loading?: boolean; error?: boolean }) {
  if (!loading && !error && !agent?.tests?.length) return null;
  return (
    <Card className="mb-4" data-testid="agent-results-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className={`h-4 w-4 ${typeText("test", "agent")}`} aria-hidden="true" />
          Agent results
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-16 w-full" data-testid="agent-results-loading" />
        ) : error ? (
          <p className="text-sm text-muted-foreground" role="status">Could not load agent results.</p>
        ) : (
          agent?.tests.map((t, i) => (
            <section key={`${t.testId ?? t.title}-${i}`} className="space-y-2" data-testid="agent-results-test">
              <h3 className="break-words text-sm font-medium">{t.title}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Pass rate" value={`${Math.round(t.passRate * 100)}%`} />
                <Stat label="Attempts" value={`${t.passed} of ${t.attempts} passed`} />
                <Stat label="Tokens" value={String((t.totalTokens ?? 0) + (t.judgeTokens ?? 0))} />
                <Stat label="Slowest attempt" value={seconds(t.slowestMs)} />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Tools called</div>
                {t.toolNames?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {t.toolNames.map((n) => (
                      <Badge key={n} variant="outline" className="max-w-full break-all font-mono text-xs">{n}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">None reported</p>
                )}
              </div>
              {t.failures?.length ? (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Failures</div>
                  <ul className="space-y-1 text-sm" data-testid="agent-results-failures">
                    {t.failures.map((f) => (
                      <li key={f.attempt} className="break-words">
                        <span className="font-medium">Attempt {f.attempt}:</span> {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
