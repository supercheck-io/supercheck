import { scrubString } from "@/lib/sentry-scrub";

function text(value: unknown): string {
  try {
    return scrubString(value instanceof Error ? value.message : String(value));
  } catch {
    return "[unprintable]"; // a log line must never throw from inside a catch block
  }
}

/**
 * Log-safe view of a caught value. Drizzle messages embed "params: <values>" (e.g. a live session token),
 * so never log the raw error from a query; log these fields instead.
 */
export function safeErrorFields(error: unknown): { name: string; code?: string; message: string; cause?: string } {
  try {
    const e = (error ?? {}) as { code?: unknown; cause?: unknown };
    const cause = e.cause as { code?: unknown; message?: unknown } | undefined;
    const code = e.code ?? cause?.code; // pg errors nest the code under drizzle's wrapper
    return {
      name: error instanceof Error ? error.name : "Error",
      ...(typeof code === "string" ? { code } : {}),
      message: text(error),
      // Drizzle's own message is only SQL + params; the root cause (timeout, refused...) lives here.
      ...(cause?.message ? { cause: text(cause.message) } : {}),
    };
  } catch {
    // A throwing getter (cause, code, name) must not turn a logged failure into a thrown one.
    return { name: "Error", message: "[unprintable]" };
  }
}

/**
 * Pino `err` serializer output made log-safe: drops a failed query's `params` and scrubs parameter values
 * out of the message and stack, through the `cause` chain. Every other field is kept.
 */
export function scrubSerializedError(serialized: unknown, depth = 0): unknown {
  if (!serialized || typeof serialized !== "object" || depth > 5) return serialized;
  try {
    const out: Record<string, unknown> = { ...(serialized as Record<string, unknown>) };
    delete out.params;
    for (const key of ["message", "stack"]) {
      if (typeof out[key] === "string") out[key] = scrubStack(out[key] as string);
    }
    if (out.cause) out.cause = scrubSerializedError(out.cause, depth + 1);
    return out;
  } catch {
    return { type: "Error", message: "[unprintable]" };
  }
}

// A stack is message line(s), "    at ..." frames, and for a cause chain "caused by: <message>" lines and their
// frames. Scrub the message parts, keep the frames.
function scrubStack(value: string): string {
  return value
    .split(/(?=\ncaused by: )/)
    .map((part) => {
      const frames = part.search(/\n\s+at /);
      return frames < 0 ? scrubString(part) : `${scrubString(part.slice(0, frames))}${part.slice(frames)}`;
    })
    .join("");
}
