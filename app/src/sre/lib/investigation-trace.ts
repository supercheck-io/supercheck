import { redactConnectorText } from "@/lib/sre/connectors/output-sanitizer";

/**
 * Bounded, sanitized trace of an investigation run for the "How I investigated"
 * view. Never stores prompts, evidence text, raw tool arguments or results; a
 * failed step keeps only a short redacted error reason.
 */
export type SreInvestigationStep = {
  index: number;
  tool: string;
  /** Short key=value summary of the arguments with secrets redacted. */
  args: string;
  status: "ok" | "error" | "empty";
  /** Number of items returned, when the tool returns a list. */
  resultCount: number | null;
  durationMs: number;
  /** Short reason a tool gave for its error (tools redact their own messages), so a failed step is debuggable. */
  error?: string;
};

export const MAX_TRACE_STEPS = 30;
const MAX_ARGS_LENGTH = 160;
const MAX_VALUE_LENGTH = 48;
const SECRET_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|credential|cookie|bearer)/i;

// Values that look like credentials are hidden even under an innocent key name.
const SECRET_VALUE = /(^\s*(bearer|basic)\s|eyJ[A-Za-z0-9_-]{10,}|\b(sk|pk|sck|ghp|glpat|xox[abp])[-_][A-Za-z0-9_-]{8,}|^[A-Za-z0-9+/=_-]{32,}$)/i;

/** Collapses whitespace, redacts credential-like text and caps the length. Also applied on read. */
function sanitizeReason(message: unknown): string | undefined {
  if (typeof message !== "string" || !message.trim()) return undefined;
  const flat = redactConnectorText(message.replace(/\s+/g, " ").trim());
  if (SECRET_VALUE.test(flat)) return "[redacted]";
  return flat.length > MAX_ARGS_LENGTH ? `${flat.slice(0, MAX_ARGS_LENGTH - 3)}...` : flat;
}

/** Reason for a tool that threw. The SDK's invalid-input message embeds the raw arguments, so those get a fixed reason. */
function thrownReason(error: unknown): string | undefined {
  const name = error instanceof Error ? error.name : "";
  if (/^AI_(InvalidToolInput|NoSuchTool)Error$/.test(name)) return "The model called the tool with invalid input";
  return error instanceof Error ? sanitizeReason(error.message) : (summarizeError(error) ?? sanitizeReason(error));
}

function summarizeError(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  return sanitizeReason((output as Record<string, unknown>).message);
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    if (SECRET_VALUE.test(flat)) return "[redacted]";
    return flat.length > MAX_VALUE_LENGTH ? `${flat.slice(0, MAX_VALUE_LENGTH - 3)}...` : flat;
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  return "{...}";
}

export function summarizeToolArgs(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 8)) {
    parts.push(`${key}=${SECRET_KEY.test(key) ? "[redacted]" : summarizeValue(value)}`);
  }
  const joined = parts.join(", ");
  return joined.length > MAX_ARGS_LENGTH ? `${joined.slice(0, MAX_ARGS_LENGTH - 3)}...` : joined;
}

function countResults(output: unknown): number | null {
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== "object") return null;
  for (const value of Object.values(output as Record<string, unknown>)) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function outputStatus(output: unknown, count: number | null): SreInvestigationStep["status"] {
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
    if (record.error || status === "error" || status === "failed") return "error";
  }
  return count === 0 ? "empty" : "ok";
}

type StepLike = {
  toolCalls?: Array<{ toolCallId?: string; toolName: string; input?: unknown }>;
  toolResults?: Array<{ toolCallId?: string; output?: unknown }>;
  content?: Array<{ type: string; toolCallId?: string; error?: unknown }>;
};

/** Converts one finished model step into trace entries (one per tool call). */
export function stepsFromModelStep(
  step: StepLike,
  startIndex: number,
  durationMs: number,
): SreInvestigationStep[] {
  const calls = step.toolCalls ?? [];
  const thrown = new Map(
    (step.content ?? []).filter((part) => part.type === "tool-error").map((part) => [part.toolCallId, part.error]),
  );
  const perCall = calls.length > 0 ? Math.round(durationMs / calls.length) : 0;
  return calls.map((call, offset) => {
    const result = step.toolResults?.find((candidate) => candidate.toolCallId === call.toolCallId);
    const count = result ? countResults(result.output) : null;
    const status = thrown.has(call.toolCallId)
      ? "error"
      : result
        ? outputStatus(result.output, count)
        : "error";
    const thrownError = thrown.get(call.toolCallId);
    const error =
      status !== "error"
        ? undefined
        : thrown.has(call.toolCallId)
          ? thrownReason(thrownError)
          : result
            ? summarizeError(result.output)
            : undefined;
    return {
      index: startIndex + offset,
      tool: call.toolName.slice(0, 80),
      args: summarizeToolArgs(call.input),
      status,
      resultCount: count,
      durationMs: perCall,
      ...(error ? { error } : {}),
    };
  });
}

/** Defensive read of the jsonb column. */
export function readStoredSteps(value: unknown): SreInvestigationStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TRACE_STEPS).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.tool !== "string") return [];
    return [
      {
        index: typeof e.index === "number" ? e.index : 0,
        tool: e.tool,
        args: typeof e.args === "string" ? e.args : "",
        status: e.status === "error" || e.status === "empty" ? e.status : "ok",
        resultCount: typeof e.resultCount === "number" ? e.resultCount : null,
        durationMs: typeof e.durationMs === "number" ? e.durationMs : 0,
        ...(sanitizeReason(e.error) ? { error: sanitizeReason(e.error) } : {}),
      } satisfies SreInvestigationStep,
    ];
  });
}
