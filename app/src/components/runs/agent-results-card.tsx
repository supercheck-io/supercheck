import { AlertCircle, Bot, CheckCircle2, Coins, Repeat, Timer, Wrench, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { typeText } from "@/lib/type-tones";
import { cn } from "@/lib/utils";

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

// Full pass, partial, none.
const rateTone = (rate: number) => (rate >= 1 ? "text-success" : rate > 0 ? "text-warning" : "text-failure");

function Stat({ icon: Icon, iconClass, label, value, valueClass }: { icon: LucideIcon; iconClass: string; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className={cn("h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={cn("text-sm font-semibold tabular-nums", valueClass)}>{value}</div>
      </div>
    </div>
  );
}

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
        className="max-h-[min(80vh,40rem)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto p-0"
        aria-label="Agent results"
        data-testid="agent-results-card"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Bot className={cn("h-4 w-4", typeText("test", "agent"))} aria-hidden="true" />
          <h4 className="text-sm font-semibold">Agent results</h4>
          {!loading && !error && agent?.tests.length ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {agent.tests.length} {agent.tests.length === 1 ? "test" : "tests"}
            </span>
          ) : null}
        </div>
        <div className="space-y-2 p-3">
        {loading ? (
          <Skeleton className="h-16 w-full" data-testid="agent-results-loading" />
        ) : error ? (
          <p className="px-1 text-sm text-muted-foreground" role="status">Could not load agent results.</p>
        ) : (
          agent?.tests.map((t, i) => (
            <section key={`${t.testId ?? t.title}-${i}`} className="space-y-3 rounded-md border bg-muted/30 p-3" data-testid="agent-results-test">
              <h3 className="break-words text-sm font-medium">{t.title}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat icon={t.passRate >= 1 ? CheckCircle2 : AlertCircle} iconClass={rateTone(t.passRate)} label="Pass rate" value={`${Math.round(t.passRate * 100)}%`} valueClass={rateTone(t.passRate)} />
                <Stat icon={Repeat} iconClass="text-muted-foreground" label="Attempts" value={`${t.passed} of ${t.attempts} passed`} />
                <Stat icon={Coins} iconClass="text-ai" label="Tokens" value={String((t.totalTokens ?? 0) + (t.judgeTokens ?? 0))} />
                <Stat icon={Timer} iconClass="text-muted-foreground" label="Slowest attempt" value={seconds(t.slowestMs)} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium text-muted-foreground">Tools called</span>
                {t.toolNames?.length ? (
                  t.toolNames.map((n, ni) => (
                    <Badge key={ni} variant="outline" className="max-w-full break-all bg-background font-mono text-xs">{n}</Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">None reported</span>
                )}
              </div>
              {t.failures?.length ? (
                <div className="space-y-1 rounded-md border border-failure/30 bg-failure/5 p-2">
                  <div className="text-xs font-medium text-failure">Failures</div>
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
