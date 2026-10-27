/**
 * Entry point for Sentry in the worker. Imports no @sentry/* code itself: the SDK
 * module is required lazily, only after the enable gate (DSN set, not self-hosted)
 * passes, so a disabled or self-hosted worker never loads the SDK.
 */
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { getSentryDsn } from './sentry-gate';

type SentryModule = typeof import('./sentry');

let sdk: SentryModule | null = null;
const load = (): SentryModule | null => {
  if (!getSentryDsn()) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (sdk ??= require('./sentry') as SentryModule);
};

/** No-op unless SENTRY_DSN is set and SELF_HOSTED is not true. */
export function initSentry(): boolean {
  try {
    return load()?.initSentry() ?? false;
  } catch {
    return false;
  }
}

type JobLike = {
  id?: string;
  queueName?: string;
  data?: unknown;
  attemptsMade?: number;
  opts?: { attempts?: number };
};

/** Reports only the final failed attempt of a job. Never throws. */
export function captureJobFailure(
  job: JobLike | undefined,
  error: Error,
): void {
  try {
    // UnrecoverableError ends a job early, so that attempt is final too.
    const final =
      error?.name === 'UnrecoverableError' ||
      (job?.attemptsMade ?? 1) >= (job?.opts?.attempts ?? 1);
    if (!final) return;
    load()?.reportJobFailure(job, error);
  } catch {
    // Error reporting must never break job handling.
  }
}

/** Flushes pending Sentry events when the Nest app shuts down. */
@Injectable()
export class SentryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    try {
      // Only flush if the SDK was ever loaded.
      await sdk?.closeSentry(2000);
    } catch {
      // Flushing is best effort.
    }
  }
}
