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
}
