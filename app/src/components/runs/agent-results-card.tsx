import { AlertCircle, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

/** Agent test summary (runs.metadata.agent) behind a header button, like the monitor detail popovers, so the report keeps its height. Renders nothing when the run has none. */
export function AgentResultsButton({ agent, loading = false, error = false }: { agent?: AgentRunSummary | null; loading?: boolean; error?: boolean }) {
  if (!loading && !error && !agent?.tests?.length) return null;
  const failing = !loading && !error && agent?.tests.some((t) => t.passRate < 1);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 px-3" data-testid="agent-results-button">
          {failing ? (
            <AlertCircle className="h-4 w-4 text-failure" aria-hidden="true" />
          ) : (
            <Bot className={`h-4 w-4 ${typeText("test", "agent")}`} aria-hidden="true" />
          )}
          Agent results
          {failing && <span className="sr-only"> (some attempts failed)</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(70vh,36rem)] w-[min(32rem,calc(100vw-2rem))] space-y-4 overflow-y-auto"
        data-testid="agent-results-card"
      >
        <h4 className="text-sm font-semibold">Agent results</h4>
        {loading ? (
          <Skeleton className="h-16 w-full" data-testid="agent-results-loading" />
        ) : error ? (
          <p className="text-sm text-muted-foreground" role="status">Could not load agent results.</p>
        ) : (
          agent?.tests.map((t, i) => (
            <section key={`${t.testId ?? t.title}-${i}`} className="space-y-2" data-testid="agent-results-test">
              <h3 className="break-words text-sm font-medium">{t.title}</h3>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Pass rate" value={`${Math.round(t.passRate * 100)}%`} />
                <Stat label="Attempts" value={`${t.passed} of ${t.attempts} passed`} />
                <Stat label="Tokens" value={String((t.totalTokens ?? 0) + (t.judgeTokens ?? 0))} />
                <Stat label="Slowest attempt" value={seconds(t.slowestMs)} />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Tools called</div>
                {t.toolNames?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {t.toolNames.map((n, ni) => (
                      <Badge key={ni} variant="outline" className="max-w-full break-all font-mono text-xs">{n}</Badge>
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
                    {t.failures.map((f, fi) => (
                      <li key={fi} className="break-words">
                        <span className="font-medium">Attempt {f.attempt}:</span> {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
