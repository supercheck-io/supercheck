/** A redirect the monitor cannot follow: loop, hop limit or a Location that is not a usable URL. */
export class MonitorRedirectError extends Error {}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'ENODATA']);

/** Codes on the error, its cause and (for multi-address connects) AggregateError members. */
export function networkErrorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 2) return;
    const { code, cause, errors } = value as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof code === 'string') codes.push(code);
    visit(cause, depth + 1);
    if (Array.isArray(errors)) errors.forEach((e) => visit(e, depth + 1));
  };
  visit(error, 0);
  return codes;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

/**
 * Node reports `connect ETIMEDOUT` with a code, sometimes only inside an AggregateError. When codes
 * exist they decide (every one must be ETIMEDOUT, so a refusal on another address is not a timeout);
 * the message is only consulted for code-less errors, since hostnames can contain "timeout".
 */
export function isTimeoutError(error: unknown): boolean {
  const codes = networkErrorCodes(error);
  if (codes.length > 0) return codes.every((code) => code === 'ETIMEDOUT');
  return /timeout|timed out/i.test(message(error));
}

export function isDnsError(error: unknown): boolean {
  return networkErrorCodes(error).some((code) => DNS_CODES.has(code));
}
