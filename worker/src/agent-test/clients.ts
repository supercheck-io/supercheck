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

let projectSecretsRaw: string | undefined;
let projectSecretsCache: string[] = [];

/** Every project secret, as the worker hands them to the run: what getSecret() can return, wherever the script puts it. */
export function projectSecrets(): string[] {
  const raw = process.env.SUPERCHECK_SECRETS_B64;
  if (raw !== projectSecretsRaw) {
    projectSecretsRaw = raw;
    try {
      projectSecretsCache = Object.values(
        (JSON.parse(Buffer.from(raw ?? '', 'base64').toString('utf8')) ??
          {}) as Record<string, unknown>,
      ).filter((v): v is string => typeof v === 'string');
    } catch {
      projectSecretsCache = [];
    }
  }
  return projectSecretsCache;
}

/** A secret as an agent may echo it: raw, URL-, JSON- and base64-encoded (at each byte offset, so `user:secret` Basic auth is caught too). */
export function encodedForms(secret: string): string[] {
  const url = encodeURIComponent(secret);
  const json = JSON.stringify(secret).slice(1, -1);
  const forms = [
    secret,
    url,
    url.replace(/%20/g, '+'),
    encodeURI(secret),
    json,
    // PHP escapes "/"; Go and Python (ensure_ascii) write &, <, > or non-ASCII as \u00xx.
    json.replace(/\//g, '\\/'),
    json.replace(
      /[^\x20-\x7e]|[&<>]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ),
  ];
  const bytes = Buffer.from(secret, 'utf8');
  for (let pad = 0; pad < 3; pad++) {
    // Only the base64 characters made purely of the secret's bits, whatever comes before or after it.
    const b64 = Buffer.concat([Buffer.alloc(pad), bytes]).toString('base64');
    const core = b64.slice(
      Math.ceil((pad * 8) / 6),
      Math.floor(((pad + bytes.length) * 8) / 6),
    );
    forms.push(core, core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return forms.filter((f) => f.length >= MIN_SECRET);
}

/** Removes the given secrets and every project secret, in each encoded form. */
export function redact(text: string, secrets: string[]): string {
  const forms = [
    ...new Set(
      [...secrets, ...projectSecrets()]
        .filter((s) => s.length >= MIN_SECRET)
        .flatMap(encodedForms),
    ),
  ].sort((a, b) => b.length - a.length);
  let out = text;
  for (const s of forms) out = out.split(s).join('[REDACTED]');
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
      // Never followed: a redirect could point at a private address, and would carry custom credential headers
      // to another host.
      redirect: 'manual',
      signal: AbortSignal.timeout(
        deadlineAt === undefined
          ? timeoutMs
          : Math.max(deadlineAt - Date.now(), 1),
      ),
    });
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => undefined);
      throw new Error(
        `${kind} agent replied with a redirect (HTTP ${res.status}) to ${redact(res.headers.get('location') ?? 'nowhere', secrets).slice(0, 200)}; connect to the final URL instead`,
      );
    }
    text = await readReply(
      res.body,
      rpcId !== undefined &&
        res.ok &&
        (res.headers.get('content-type') ?? '').includes('text/event-stream')
        ? rpcId
        : undefined,
    );
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    if (e.message.startsWith(`${kind} agent replied with a redirect`)) throw e;
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

export const MAX_REPLY_BYTES = 5 * 1024 * 1024;

/** Reads a reply body, at most MAX_REPLY_BYTES. With an rpcId (an SSE reply), stops once a complete event carries it. */
async function readReply(
  body: ReadableStream<Uint8Array> | null,
  rpcId?: number,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  // Start of the first SSE event not yet complete: each event is parsed once, not again on every chunk.
  let scanned = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_REPLY_BYTES)
        throw new Error(`reply is larger than ${MAX_REPLY_BYTES} bytes`);
      text += decoder.decode(value, { stream: true });
      if (rpcId === undefined) continue;
      const blocks = text.slice(scanned).split(/\r?\n\r?\n/);
      const pending = blocks.pop() ?? '';
      if (blocks.some((block) => sseEventId(block) === rpcId)) return text;
      scanned = text.length - pending.length;
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
        redirect: 'manual',
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
