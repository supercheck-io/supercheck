/**
 * Per-organization daily AI token cap for SRE model calls (investigate, triage,
 * evidence brief, chat). Redis counter keyed by UTC day, checked before a call
 * starts and incremented from the usage the model reports after each step.
 *
 * The check is not atomic with the increment, so concurrent in-flight calls can
 * overshoot the cap by their own usage. That is acceptable for a cost guard.
 * Fails closed when Redis is unavailable, like the SRE rate limiter.
 */

import { NextResponse } from "next/server";

import { getRedisConnection } from "@/lib/queue";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "sre-daily-token-limit" }) as {
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

const KEY_PREFIX = "supercheck:sre:tokens";
const DEFAULT_DAILY_TOKEN_LIMIT = 2_000_000;
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;
const REDIS_TIMEOUT_MS = 2_000;

// A stalled Redis connection must not hang an AI request or a finished call.
function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SRE token limit Redis timeout")), REDIS_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export const SRE_DAILY_LIMIT_CODE = "daily_ai_limit";
export const SRE_LIMIT_UNAVAILABLE_MESSAGE =
  "AI usage limit check is temporarily unavailable. Please try again shortly.";
export const SRE_DAILY_LIMIT_MESSAGE =
  "Daily AI usage limit reached for your organization. It resets at 00:00 UTC.";

/** SRE_DAILY_TOKEN_LIMIT_PER_ORG: positive integer, 0 disables, invalid uses the default. */
export function getSreDailyTokenLimit(): number {
  const raw = process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG?.trim();
  if (!raw) return DEFAULT_DAILY_TOKEN_LIMIT;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_TOKEN_LIMIT;
}

function dayKey(organizationId: string, now: Date) {
  return `${KEY_PREFIX}:${organizationId}:${now.toISOString().slice(0, 10)}`;
}

function nextUtcMidnight(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

export type SreDailyTokenLimitResult = {
  allowed: boolean;
  resetTime: number;
  unavailable?: boolean;
};

export async function checkSreDailyTokenLimit(
  organizationId: string,
): Promise<SreDailyTokenLimitResult> {
  const now = new Date();
  const resetTime = nextUtcMidnight(now);
  const limit = getSreDailyTokenLimit();
  if (limit === 0) return { allowed: true, resetTime };

  try {
    const redis = await withTimeout(getRedisConnection());
    if (!redis) {
      logger.warn({ organizationId }, "Redis unavailable for SRE daily token limit, denying request");
      return { allowed: false, resetTime, unavailable: true };
    }
    const used = Number(await withTimeout(redis.get(dayKey(organizationId, now)))) || 0;
    return { allowed: used < limit, resetTime };
  } catch (error) {
    logger.error({ err: error, organizationId }, "SRE daily token limit check failed, denying request");
    return { allowed: false, resetTime, unavailable: true };
  }
}

/** Adds reported usage to today's counter. Never throws: usage accounting must not fail a finished call. */
export async function recordSreTokenUsage(
  organizationId: string,
  usage: { totalTokens?: number | null; inputTokens?: number | null; outputTokens?: number | null } | undefined,
): Promise<void> {
  const tokens = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  if (!Number.isFinite(tokens) || tokens <= 0 || getSreDailyTokenLimit() === 0) return;

  try {
    const redis = await withTimeout(getRedisConnection());
    if (!redis) return;
    const key = dayKey(organizationId, new Date());
    await withTimeout(redis.multi().incrby(key, Math.ceil(tokens)).expire(key, KEY_TTL_SECONDS).exec());
  } catch (error) {
    logger.error({ err: error, organizationId }, "Failed to record SRE token usage");
  }
}

export class SreDailyTokenLimitError extends Error {
  readonly code = SRE_DAILY_LIMIT_CODE;
  constructor(readonly resetTime: number, readonly unavailable = false) {
    super(unavailable ? SRE_LIMIT_UNAVAILABLE_MESSAGE : SRE_DAILY_LIMIT_MESSAGE);
    this.name = "SreDailyTokenLimitError";
  }
}

export async function assertSreDailyTokenLimit(organizationId: string): Promise<void> {
  const result = await checkSreDailyTokenLimit(organizationId);
  if (!result.allowed) throw new SreDailyTokenLimitError(result.resetTime, result.unavailable);
}

/** Null when the call may proceed; otherwise the response routes return before starting AI work. */
export async function sreDailyTokenLimitResponse(organizationId: string): Promise<NextResponse | null> {
  const result = await checkSreDailyTokenLimit(organizationId);
  if (result.allowed) return null;
  if (result.unavailable) {
    return NextResponse.json(
      { error: SRE_LIMIT_UNAVAILABLE_MESSAGE, code: "daily_ai_limit_unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  const retryAfter = Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000));
  return NextResponse.json(
    { error: SRE_DAILY_LIMIT_MESSAGE, code: SRE_DAILY_LIMIT_CODE },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
