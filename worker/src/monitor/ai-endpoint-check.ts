import type { Readable } from 'node:stream';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosError } from 'axios';
import type {
  MonitorConfig,
  MonitorResultDetails,
  MonitorResultStatus,
} from '../db/schema/types';
import { requestPinnedMonitorTarget } from '../common/utils/pinned-monitor-request';
import {
  MonitorRedirectError,
  isDnsError,
  isTimeoutError,
} from '../common/utils/network-error';
import { allowInternalMonitorTargets } from '../common/utils/url-validator';
import { readSse } from '../common/utils/sse';
import type { MonitorSecretResult } from './monitor-secret';

const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 300;
const DEFAULT_PROMPT = 'Reply with the single word OK.';

export interface AiEndpointDeps {
  execute: (
    config: AxiosRequestConfig<unknown>,
  ) => Promise<AxiosResponse<unknown>>;
  resolveSecret: (key: string) => Promise<MonitorSecretResult>;
}

export interface AiEndpointResult {
  status: MonitorResultStatus;
  details: MonitorResultDetails;
  responseTimeMs: number;
  isUp: boolean;
}

interface Outcome {
  httpStatus: number;
  errType?: string;
  errCode?: string;
  /** Error carried inside a 2xx reply (body, chunk or finish_reason). */
  innerError?: string;
  text: string;
  done: boolean;
  cutOff: boolean;
  timedOut?: 'first' | 'total';
  firstTokenMs?: number;
  ai: Partial<NonNullable<MonitorResultDetails['ai']>>;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

const seconds = (ms: number) =>
  `${Math.round(ms / 100) / 10}`.replace(/\.0$/, '');

function errorCode(error: Json): string {
  return str(error.code) ?? str(error.type) ?? 'unknown';
}

function isBillingError(type?: string, code?: string): boolean {
  return [type, code].some(
    (v) =>
      v === 'insufficient_quota' ||
      v === 'credit_balance_exhausted' ||
      /_spend_limit_exceeded$|_usage_limit_exceeded$/.test(v ?? ''),
  );
}

async function readAll(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buf);
      bytes += buf.length;
      if (bytes > maxBytes) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): Json | undefined {
  try {
    return obj(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function applyPayload(payload: Json, out: Outcome, startedAt: bigint): void {
  const error = obj(payload.error);
  if (error) out.innerError ??= errorCode(error);
  out.ai.servedModel ??= str(payload.model);
  out.ai.systemFingerprint ??= str(payload.system_fingerprint);
  const usage = obj(payload.usage);
  if (usage) {
    out.ai.promptTokens = num(usage.prompt_tokens) ?? out.ai.promptTokens;
    out.ai.completionTokens =
      num(usage.completion_tokens) ?? out.ai.completionTokens;
    out.ai.totalTokens = num(usage.total_tokens) ?? out.ai.totalTokens;
    out.ai.cost = num(usage.cost) ?? out.ai.cost;
  }
  const choice = obj(
    Array.isArray(payload.choices) ? payload.choices[0] : undefined,
  );
  if (!choice) return;
  if (choice.finish_reason === 'error')
    out.innerError ??= 'finish_reason_error';
  const content =
    str(obj(choice.delta)?.content) ?? str(obj(choice.message)?.content);
  if (content) {
    out.text += content;
    out.firstTokenMs ??= Number(process.hrtime.bigint() - startedAt) / 1e6;
  }
}

async function consume(
  response: AxiosResponse<unknown>,
  startedAt: bigint,
  limits: { firstTokenMs: number; totalMs: number },
): Promise<Outcome> {
  const stream = response.data as Readable;
  const out: Outcome = {
    httpStatus: response.status,
    text: '',
    done: false,
    cutOff: false,
    ai: {},
  };

  if (response.status < 200 || response.status >= 300) {
    const err = obj(
      parseJson(await readAll(stream, MAX_ERROR_BODY_BYTES))?.error,
    );
    out.errType = str(err?.type);
    out.errCode = str(err?.code);
    return out;
  }

  const elapsed = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  const timers: NodeJS.Timeout[] = [];
  timers.push(
    setTimeout(
      () => {
        if (out.firstTokenMs === undefined) {
          out.timedOut = 'first';
          stream.destroy();
        }
      },
      Math.max(0, limits.firstTokenMs - elapsed()),
    ),
    setTimeout(
      () => {
        out.timedOut ??= 'total';
        stream.destroy();
      },
      Math.max(0, limits.totalMs - elapsed()),
    ),
  );

  try {
    if (
      String(response.headers?.['content-type'] ?? '').includes(
        'application/json',
      )
    ) {
      // A non-streamed reply (or a JSON error with status 200).
      const body = parseJson(await readAll(stream, MAX_STREAM_BYTES));
      if (body) applyPayload(body, out, startedAt);
      out.done = true;
    } else {
      const result = await readSse(
        stream,
        (data) => {
          const payload = parseJson(data);
          if (payload) applyPayload(payload, out, startedAt);
        },
        MAX_STREAM_BYTES,
      );
      out.done = result.done;
    }
  } catch {
    // Destroyed by our own timers (timedOut set) or the connection dropped mid-reply.
    out.cutOff = true;
    // The request's own abort signal can beat our timer to the deadline.
    if (elapsed() >= limits.totalMs) out.timedOut ??= 'total';
  } finally {
    timers.forEach(clearTimeout);
  }
  out.ai.firstTokenMs = out.firstTokenMs;
  return out;
}

function judge(
  out: Outcome,
  config: NonNullable<MonitorConfig['aiEndpoint']>,
  firstTokenLimitMs: number,
  totalLimitMs: number,
): { status: MonitorResultStatus; message?: string } {
  const down = (message: string) => ({ status: 'down' as const, message });
  if (out.timedOut === 'first') {
    return {
      status: 'timeout',
      message: `No first token within ${seconds(firstTokenLimitMs)} s`,
    };
  }
  if (out.timedOut === 'total') {
    return {
      status: 'timeout',
      message: `Timed out after ${seconds(totalLimitMs)} s`,
    };
  }
  if (out.firstTokenMs !== undefined && out.firstTokenMs > firstTokenLimitMs) {
    return {
      status: 'timeout',
      message: `No first token within ${seconds(firstTokenLimitMs)} s`,
    };
  }
  const code = out.httpStatus;
  if (code === 401 || code === 403) return down(`Key rejected (${code})`);
  if (code === 429) {
    return down(
      isBillingError(out.errType, out.errCode)
        ? 'Out of credit or over the spend limit'
        : 'Rate limited (429)',
    );
  }
  if (code < 200 || code >= 300) return down(`HTTP ${code}`);
  if (out.innerError)
    return down(`Error inside a 200 reply: ${out.innerError}`);
  if (!out.done || out.cutOff) return down('Reply was cut off');
  if (!out.text.trim()) return down('Empty reply');
  if (
    config.expectText &&
    !out.text.toLowerCase().includes(config.expectText.toLowerCase())
  ) {
    return down('Reply did not contain the expected text');
  }
  return { status: 'up' };
}

/**
 * One paid, streamed chat-completions call. The reply stream is read to the end inside the pinned
 * request callback, because pinned agents are destroyed as soon as it resolves. Reply text is judged
 * and dropped, never stored.
 */
export async function executeAiEndpointCheck(
  target: string,
  config: MonitorConfig,
  deps: AiEndpointDeps,
): Promise<AiEndpointResult> {
  const ai = config.aiEndpoint!;
  const startedAt = process.hrtime.bigint();
  const totalLimitMs = (config.timeoutSeconds ?? 60) * 1000;
  const firstTokenLimitMs = ai.firstTokenTimeoutMs ?? 15000;
  const secrets: string[] = [];
  const totalMs = () =>
    Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  const finish = (
    status: MonitorResultStatus,
    message: string | undefined,
    details: MonitorResultDetails = {},
  ): AiEndpointResult => {
    let text = message ?? '';
    for (const secret of secrets)
      if (secret) text = text.split(secret).join('***');
    if (text) details.errorMessage = text.slice(0, MAX_MESSAGE_CHARS);
    const ms = totalMs();
    details.ai = { ...details.ai, totalMs: ms };
    return { status, details, responseTimeMs: ms, isUp: status === 'up' };
  };

  const headers: Record<string, string> = {
    'User-Agent': 'Supercheck-Monitor/1.0',
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  };
  if (ai.secretKey) {
    const secret = await deps.resolveSecret(ai.secretKey);
    if (!secret.ok) return finish('error', secret.message);
    secrets.push(secret.value);
    const header = ai.keyHeader || 'Authorization';
    headers[header] =
      header.toLowerCase() === 'authorization'
        ? `Bearer ${secret.value}`
        : secret.value;
  }

  try {
    const response = await requestPinnedMonitorTarget(
      {
        method: 'POST',
        url: target,
        headers,
        data: {
          model: ai.model,
          messages: [{ role: 'user', content: ai.prompt || DEFAULT_PROMPT }],
          max_tokens: ai.maxTokens ?? 16,
          stream: true,
          stream_options: { include_usage: true },
        },
        timeout: totalLimitMs,
        responseType: 'stream',
        decompress: true,
        validateStatus: () => true,
      },
      { allowInternalTargets: allowInternalMonitorTargets(), maxRedirects: 0 },
      async (cfg) => {
        // The first-token limit also covers a gateway that holds the headers until the model starts.
        const firstToken = new AbortController();
        const headerTimer = setTimeout(
          () => firstToken.abort(),
          Math.max(0, firstTokenLimitMs - totalMs()),
        );
        let res: AxiosResponse<unknown>;
        try {
          res = await deps.execute({
            ...cfg,
            signal: cfg.signal
              ? AbortSignal.any([cfg.signal as AbortSignal, firstToken.signal])
              : firstToken.signal,
          });
        } catch (error) {
          if (!firstToken.signal.aborted) throw error;
          const outcome: Outcome = {
            httpStatus: 0,
            text: '',
            done: false,
            cutOff: false,
            ai: {},
            timedOut: 'first',
          };
          return {
            status: 0,
            statusText: '',
            headers: {},
            config: cfg,
            data: outcome,
          } as AxiosResponse<unknown>;
        } finally {
          clearTimeout(headerTimer);
        }
        if (res.status >= 300 && res.status < 400 && res.headers?.location) {
          (res.data as Readable | undefined)?.destroy?.();
          return res;
        }
        const outcome = await consume(res, startedAt, {
          firstTokenMs: firstTokenLimitMs,
          totalMs: totalLimitMs,
        });
        return { ...res, data: outcome };
      },
    );
    const out = response.data as Outcome;
    const verdict = judge(out, ai, firstTokenLimitMs, totalLimitMs);
    return finish(verdict.status, verdict.message, {
      statusCode: out.httpStatus,
      ai: { ...out.ai, totalMs: 0 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MonitorRedirectError) {
      return finish('down', 'Redirect not followed');
    }
    if (
      isTimeoutError(error) ||
      (error instanceof AxiosError &&
        (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED'))
    ) {
      return finish('timeout', `Timed out after ${seconds(totalLimitMs)} s`);
    }
    if (isDnsError(error)) return finish('down', 'DNS lookup failed');
    // Unexpected errors (private target refused, bad URL) are check errors, not outages.
    return finish(
      /private or reserved|must use HTTP|credentials/.test(message)
        ? 'error'
        : 'down',
      message,
    );
  }
}
