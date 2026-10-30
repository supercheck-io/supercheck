// Kept out of ai-security so route specs that mock that module still get the real matcher.
export function isAiRateLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : "").toLowerCase();
  return message.includes("rate limit") || message.includes("too many requests");
}
