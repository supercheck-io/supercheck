import { randomUUID } from 'node:crypto';
import {
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
} from 'node:net';
import type {
  AgentClient,
  AgentCommonOptions,
  AgentOptions,
  AgentReply,
  AgentToolCall,
  AgentUsage,
} from './types';

// Node tries each address of a host for only 250 ms by default, so an agent more than ~250 ms away
// fails with ETIMEDOUT although curl reaches it. The setting is process-wide; only agent test processes load this module.
export const CONNECT_ATTEMPT_MS = 2_000;
if (getDefaultAutoSelectFamilyAttemptTimeout() < CONNECT_ATTEMPT_MS)
  setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const noUsage = (): AgentUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

const CREDENTIAL_HEADER = /key|token|secret|auth|cookie/i;
const MIN_SECRET = 4;

/** The key, credential-like header values and URL credentials: removed from anything we put in an Error or summary. */
export function secretsOf(options: AgentCommonOptions): string[] {
  const out: unknown[] = [options.apiKey];
  for (const [name, value] of Object.entries(options.headers ?? {}))
    if (CREDENTIAL_HEADER.test(name))
      // "Bearer abc" leaks as bare "abc" too
      out.push(value, typeof value === 'string' && value.split(/\s+/).pop());
  try {
    const u = new URL((options as { url?: string }).url ?? '');
    out.push(u.username, u.password);
    for (const part of [u.username, u.password])
      out.push(decodeURIComponent(part));
  } catch {
    // no URL, or no credentials in it
  }
  return [
    ...new Set(
      out.filter(
        (v): v is string => typeof v === 'string' && v.length >= MIN_SECRET,
      ),
    ),
  ];
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length))
    out = out.split(s).join('[REDACTED]');
  return out;
}

const timeoutOf = (options: AgentCommonOptions) =>
  Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS,
  );

/** Set in order, so names collapse case-insensitively and a user `Authorization` overrides the apiKey. */
function requestHeaders(
  options: AgentCommonOptions,
  base: Record<string, string>,
  extra: Record<string, string> = {},
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(base)) headers.set(name, value);
  if (options.apiKey) headers.set('authorization', `Bearer ${options.apiKey}`);
  for (const layer of [extra, options.headers ?? {}])
    for (const [name, value] of Object.entries(layer)) headers.set(name, value);
  return headers;
}

/** Throws on options a run could not use; checked at connect() so a typo fails before any request. */
export function validateOptions(
  options: AgentOptions,
  where = 'agent.connect',
): void {
  const o = options as unknown as Record<string, unknown>;
  if (!['openai', 'http', 'a2a', 'mcp'].includes(String(o.kind)))
    throw new TypeError(
      `${where}: kind must be "openai", "http", "a2a" or "mcp", got ${String(o.kind)}`,
    );
  let url: URL | undefined;
  try {
    url = new URL(String(o.url));
  } catch {
    // reported below
  }
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:')
    throw new TypeError(`${where}: url must be an http(s) URL`);
  const t = options.timeoutMs;
  if (t !== undefined && (!Number.isInteger(t) || t < 1 || t > MAX_TIMEOUT_MS))
    throw new RangeError(
      `${where}: timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`,
    );
  // Redaction ignores values this short (they would blank ordinary text), so they could not be hidden.
  const credentials = [
    options.apiKey,
    ...Object.entries(options.headers ?? {}).flatMap(([name, value]) =>
      CREDENTIAL_HEADER.test(name)
        ? [value, typeof value === 'string' && value.split(/\s+/).pop()]
        : [],
    ),
  ];
  if (credentials.some((v) => typeof v === 'string' && v.length < MIN_SECRET))
    throw new Error(
      `${where}: an apiKey or credential header value must be at least ${MIN_SECRET} characters`,
    );
}

interface Post {
  status: number;
  headers: Headers;
  text: string;
}

async function post(
  kind: string,
  url: string,
  options: AgentCommonOptions,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  /** JSON-RPC id to wait for: an SSE reply is read only until that response arrives (servers may keep the stream open). */
  rpcId?: number,
  /** Absolute time (ms) the whole exchange must end by; defaults to this request's own timeout. */
  deadlineAt?: number,
): Promise<Post> {
  const timeoutMs = timeoutOf(options);
  const secrets = secretsOf(options);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: requestHeaders(
        options,
        { 'content-type': 'application/json' },
        extraHeaders,
      ),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        deadlineAt === undefined
          ? timeoutMs
          : Math.max(deadlineAt - Date.now(), 1),
      ),
    });
    text =
      rpcId !== undefined &&
      res.ok &&
      res.body &&
      (res.headers.get('content-type') ?? '').includes('text/event-stream')
        ? await readSseUntil(res.body, rpcId)
        : await res.text();
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    const why =
      e.name === 'TimeoutError' || e.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : (e.cause?.code ?? e.message);
    throw new Error(`${kind} agent request failed: ${redact(why, secrets)}`);
  }
  if (!res.ok)
    throw Object.assign(
      new Error(
        `${kind} agent replied HTTP ${res.status}: ${redact(text, secrets).slice(0, 200)}`,
      ),
      { sessionId: res.headers.get('mcp-session-id') },
    );
  return { status: res.status, headers: res.headers, text };
}

/** Reads SSE until a complete event carries the given JSON-RPC id, then stops reading. */
async function readSseUntil(
  body: ReadableStream<Uint8Array>,
  id: number,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
      const complete = text.split(/\r?\n\r?\n/).slice(0, -1);
      if (complete.some((block) => sseEventId(block) === id)) return text;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function sseEventId(block: string): unknown {
  const data = block
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
  try {
    return asRecord(JSON.parse(data)).id;
  } catch {
    return undefined;
  }
}

function parseJson(kind: string, text: string, secrets: string[]): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${kind} agent reply is not JSON: ${redact(text, secrets).slice(0, 200)}`,
    );
  }
}

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
const asNumber = (v: unknown) => (typeof v === 'number' ? v : 0);
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function reply(
  text: string,
  fields: Partial<AgentReply>,
  startedAt: number,
  raw: unknown,
): AgentReply {
  const toolCalls = fields.toolCalls ?? [];
  return {
    text,
    toolCalls,
    toolNames: toolCalls.map((t) => t.name),
    usage: fields.usage ?? noUsage(),
    json: fields.json,
    durationMs: Date.now() - startedAt,
    raw,
  };
}

/** OpenAI chat completions. Also used by agent.judge. */
export async function chatCompletion(
  options: AgentCommonOptions & {
    url: string;
    model: string;
    system?: string;
    tools?: unknown[];
  },
  messages: { role: string; content: string }[],
): Promise<AgentReply> {
  const startedAt = Date.now();
  const { text: body } = await post('openai', options.url, options, {
    model: options.model,
    messages: options.system
      ? [{ role: 'system', content: options.system }, ...messages]
      : messages,
    ...(options.tools ? { tools: options.tools } : {}),
  });
  const json = asRecord(parseJson('openai', body, secretsOf(options)));
  if (json.error) {
    const e = asRecord(json.error);
    throw new Error(
      `openai agent error: ${redact(asString(e.message, asString(json.error)), secretsOf(options)).slice(0, 200)}`,
    );
  }
  const message = asRecord(asRecord((json.choices as unknown[])?.[0]).message);
  const toolCalls: AgentToolCall[] = (
    Array.isArray(message.tool_calls) ? message.tool_calls : []
  ).map((call) => {
    const fn = asRecord(asRecord(call).function);
    let args: unknown = fn.arguments;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        // Keep the model's own string: a malformed argument list is itself something a test may assert on.
      }
    }
    return { name: asString(fn.name), arguments: args };
  });
  const u = asRecord(json.usage);
  return reply(
    typeof message.content === 'string'
      ? message.content
      : textOfParts(message.content),
    {
      toolCalls,
      usage: {
        promptTokens: asNumber(u.prompt_tokens),
        completionTokens: asNumber(u.completion_tokens),
        totalTokens:
          typeof u.total_tokens === 'number'
            ? u.total_tokens
            : asNumber(u.prompt_tokens) + asNumber(u.completion_tokens),
        ...(typeof u.cost === 'number' ? { cost: u.cost } : {}),
      },
    },
    startedAt,
    json,
  );
}

function pick(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (v, key) => (v == null ? undefined : (v as Record<string, unknown>)[key]),
      value,
    );
}

const textOfParts = (parts: unknown): string =>
  (Array.isArray(parts) ? parts : [])
    .map((p) => asRecord(p).text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');

/** JSON-RPC reply body: plain JSON, or an SSE stream holding the message with our id. */
function rpcMessage(
  kind: string,
  text: string,
  id: string | number,
  secrets: string[],
): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith('{'))
    return asRecord(parseJson(kind, trimmed, secrets));
  const events = trimmed
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join(''),
    )
    .filter(Boolean)
    .flatMap((data) => {
      try {
        return [asRecord(JSON.parse(data))];
      } catch {
        return [];
      }
    });
  const found = events.find((e) => e.id === id);
  if (!found)
    throw new Error(`${kind} agent reply has no response to request ${id}`);
  return found;
}

function rpcResult(
  kind: string,
  msg: Record<string, unknown>,
  secrets: string[],
): unknown {
  if (msg.error) {
    const e = asRecord(msg.error);
    throw new Error(
      `${kind} agent error ${asString(e.code)}: ${redact(asString(e.message), secrets).slice(0, 200)}`,
    );
  }
  return msg.result;
}

async function a2aSend(
  options: Extract<AgentOptions, { kind: 'a2a' }>,
  message: string,
): Promise<AgentReply> {
  const startedAt = Date.now();
  const id = randomUUID();
  const legacy = options.legacy === true;
  const params = {
    message: legacy
      ? {
          kind: 'message',
          messageId: randomUUID(),
          role: 'user',
          parts: [{ kind: 'text', text: message }],
        }
      : {
          messageId: randomUUID(),
          role: 'ROLE_USER',
          parts: [{ text: message }],
        },
  };
  const { text } = await post(
    'a2a',
    options.url,
    options,
    {
      jsonrpc: '2.0',
      id,
      method: legacy ? 'message/send' : 'SendMessage',
      params,
    },
    legacy ? {} : { 'a2a-version': '1.0' },
  );
  const secrets = secretsOf(options);
  const msg = rpcMessage('a2a', text, id, secrets);
  const result = asRecord(rpcResult('a2a', msg, secrets));
  // 1.0 wraps the answer as { task } or { message }; 0.3 returns the Task or Message itself.
  const body = asRecord(result.task ?? result.message ?? result);
  const status = asRecord(body.status);
  const artifacts = (Array.isArray(body.artifacts) ? body.artifacts : [])
    .map((a) => textOfParts(asRecord(a).parts))
    .filter(Boolean);
  const answer =
    body.parts !== undefined
      ? textOfParts(body.parts)
      : [textOfParts(asRecord(status.message).parts), ...artifacts]
          .filter(Boolean)
          .join('\n');
  // Tools only when the task history exposes them as data parts shaped like { name, arguments }.
  const toolCalls: AgentToolCall[] = [];
  for (const entry of Array.isArray(body.history) ? body.history : [])
    for (const part of (asRecord(entry).parts as unknown[]) ?? []) {
      const data = asRecord(asRecord(part).data);
      if (
        typeof data.name === 'string' &&
        ('arguments' in data || 'args' in data || 'input' in data)
      )
        toolCalls.push({
          name: data.name,
          arguments: data.arguments ?? data.args ?? data.input,
        });
    }
  return reply(answer, { toolCalls }, startedAt, result);
}

async function mcpSend(
  options: Extract<AgentOptions, { kind: 'mcp' }>,
  message: string,
): Promise<AgentReply> {
  const startedAt = Date.now();
  const secrets = secretsOf(options);
  const accept = { accept: 'application/json, text/event-stream' };
  const rpc = (id: number | undefined, method: string, params: unknown) => ({
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    method,
    params,
  });
  const deadlineAt = startedAt + timeoutOf(options);
  const args = { [options.argument ?? 'message']: message };
  let session: string | null = null;
  let call: Post;
  try {
    const init = await post(
      'mcp',
      options.url,
      options,
      rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'supercheck-agent-test', version: '1.0.0' },
      }),
      accept,
      1,
      deadlineAt,
    );
    // Before parsing: an init error reply may still have opened a session that must be deleted.
    session = init.headers.get('mcp-session-id');
    const initResult = asRecord(
      rpcResult('mcp', rpcMessage('mcp', init.text, 1, secrets), secrets),
    );
    const next = {
      ...accept,
      'mcp-protocol-version': asString(
        initResult.protocolVersion,
        '2025-06-18',
      ),
      ...(session ? { 'mcp-session-id': session } : {}),
    };
    await post(
      'mcp',
      options.url,
      options,
      rpc(undefined, 'notifications/initialized', {}),
      next,
      undefined,
      deadlineAt,
    );
    call = await post(
      'mcp',
      options.url,
      options,
      rpc(2, 'tools/call', { name: options.tool, arguments: args }),
      next,
      2,
      deadlineAt,
    );
  } catch (error) {
    // An initialize answered with an HTTP error may still have opened a session.
    session ??= (error as { sessionId?: string | null }).sessionId ?? null;
    throw error;
  } finally {
    // Best effort, like the worker MCP client: free the server's per-session state.
    if (session) {
      const headers = requestHeaders(options, {});
      headers.set('mcp-session-id', session);
      await fetch(options.url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }
  }
  const result = asRecord(
    rpcResult('mcp', rpcMessage('mcp', call.text, 2, secrets), secrets),
  );
  const answer = (Array.isArray(result.content) ? result.content : [])
    .map((c) => asRecord(c).text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');
  if (result.isError === true)
    throw new Error(
      `mcp tool ${options.tool} failed: ${redact(answer, secrets).slice(0, 200)}`,
    );
  return reply(
    answer,
    {
      toolCalls: [{ name: options.tool, arguments: args }],
      json: result.structuredContent,
    },
    startedAt,
    result,
  );
}

export function createClient(options: AgentOptions): AgentClient {
  return {
    async send(message, sendOptions) {
      switch (options.kind) {
        case 'openai':
          return chatCompletion(options, [
            ...(sendOptions?.conversation ?? []),
            { role: 'user', content: message },
          ]);
        case 'http': {
          const startedAt = Date.now();
          const { text } = await post(
            'http',
            options.url,
            options,
            options.body(message),
          );
          const json = parseJson('http', text, secretsOf(options));
          const value = pick(json, options.reply);
          if (value === undefined)
            throw new Error(
              `http agent reply has nothing at "${options.reply}"`,
            );
          return reply(
            typeof value === 'string' ? value : JSON.stringify(value),
            { json },
            startedAt,
            json,
          );
        }
        case 'a2a':
          return a2aSend(options, message);
        case 'mcp':
          return mcpSend(options, message);
        default:
          throw new Error(
            `Unknown agent kind: ${String((options as { kind?: unknown }).kind)}`,
          );
      }
    },
  };
}
