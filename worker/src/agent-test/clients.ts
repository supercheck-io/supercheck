import { randomUUID } from 'node:crypto';
import type {
  AgentClient,
  AgentCommonOptions,
  AgentOptions,
  AgentReply,
  AgentToolCall,
  AgentUsage,
} from './types';

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
): Promise<Post> {
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS,
  );
  const secrets = secretsOf(options);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.apiKey
          ? { authorization: `Bearer ${options.apiKey}` }
          : {}),
        ...extraHeaders,
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    const why =
      e.name === 'TimeoutError' || e.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : (e.cause?.code ?? e.message);
    throw new Error(`${kind} agent request failed: ${redact(why, secrets)}`);
  }
  if (!res.ok)
    throw new Error(
      `${kind} agent replied HTTP ${res.status}: ${redact(text, secrets).slice(0, 200)}`,
    );
  return { status: res.status, headers: res.headers, text };
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
  extraBody: Record<string, unknown> = {},
): Promise<AgentReply> {
  const startedAt = Date.now();
  const { text: body } = await post('openai', options.url, options, {
    model: options.model,
    messages: options.system
      ? [{ role: 'system', content: options.system }, ...messages]
      : messages,
    ...(options.tools ? { tools: options.tools } : {}),
    ...extraBody,
  });
  const json = asRecord(parseJson('openai', body, secretsOf(options)));
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
    typeof message.content === 'string' ? message.content : '',
    {
      toolCalls,
      usage: {
        promptTokens: asNumber(u.prompt_tokens),
        completionTokens: asNumber(u.completion_tokens),
        totalTokens: asNumber(u.total_tokens),
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
  );
  const initResult = asRecord(
    rpcResult('mcp', rpcMessage('mcp', init.text, 1, secrets), secrets),
  );
  const session = init.headers.get('mcp-session-id');
  const next = {
    ...accept,
    'mcp-protocol-version': asString(initResult.protocolVersion, '2025-06-18'),
    ...(session ? { 'mcp-session-id': session } : {}),
  };
  await post(
    'mcp',
    options.url,
    options,
    rpc(undefined, 'notifications/initialized', {}),
    next,
  );
  const args = { [options.argument ?? 'message']: message };
  const call = await post(
    'mcp',
    options.url,
    options,
    rpc(2, 'tools/call', { name: options.tool, arguments: args }),
    next,
  );
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
