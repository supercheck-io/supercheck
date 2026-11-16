/** Agent summary stored by the worker in `runs.metadata.agent`; read through this sanitizer only. */
export interface AgentRunTestSummary {
  testId?: string;
  title: string;
  attempts: number;
  passed: number;
  passRate: number;
  totalTokens: number;
  judgeTokens: number;
  cost?: number;
  toolNames: string[];
  durationMs: number;
  slowestMs: number;
  failures: { attempt: number; message: string }[];
}

export interface AgentRunSummary {
  tests: AgentRunTestSummary[];
}

const MAX_TESTS = 20;
const MAX_TOOL_NAMES = 50;
const MAX_FAILURES = 5;
const MAX_MESSAGE = 200;
const MAX_TITLE = 200;
const MAX_TOOL_NAME = 100;

type Clean = (value: string, max: number) => string;
const clip: Clean = (value, max) => (value.length > max ? value.slice(0, max) : value);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Numbers, tool names and clipped failure messages only: the database never holds transcripts, and anything else
 * found under `agent` is dropped. `clean` lets a caller redact text (MCP passes `safeText`).
 */
export function sanitizeAgentSummary(metadata: unknown, clean: Clean = clip): AgentRunSummary | undefined {
  const agent = isRecord(metadata) ? metadata.agent : undefined;
  if (!isRecord(agent) || !Array.isArray(agent.tests)) return undefined;
  const tests = agent.tests.filter(isRecord).slice(0, MAX_TESTS).map((t): AgentRunTestSummary => ({
    ...(typeof t.testId === "string" ? { testId: clean(t.testId, 64) } : {}),
    title: typeof t.title === "string" ? clean(t.title, MAX_TITLE) : "",
    attempts: num(t.attempts),
    passed: num(t.passed),
    passRate: num(t.passRate),
    totalTokens: num(t.totalTokens),
    judgeTokens: num(t.judgeTokens),
    ...(typeof t.cost === "number" && Number.isFinite(t.cost) ? { cost: t.cost } : {}),
    toolNames: (Array.isArray(t.toolNames) ? t.toolNames : [])
      .filter((n): n is string => typeof n === "string")
      .slice(0, MAX_TOOL_NAMES)
      .map((n) => clean(n, MAX_TOOL_NAME)),
    durationMs: num(t.durationMs),
    slowestMs: num(t.slowestMs),
    failures: (Array.isArray(t.failures) ? t.failures : [])
      .filter(isRecord)
      .slice(0, MAX_FAILURES)
      .map((f) => ({ attempt: num(f.attempt), message: typeof f.message === "string" ? clean(f.message, MAX_MESSAGE) : "" })),
  }));
  return { tests };
}
