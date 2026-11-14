// Transport-agnostic MCP Streamable HTTP client. The caller supplies `request` (the SSRF policy:
// private-agent or monitor), so this file never opens a socket itself. It speaks both the stateless
// 2026-07-28 revision (every POST carries the version and method headers, no session) and the
// 2025 handshake (initialize + notifications/initialized + Mcp-Session-Id). It never answers
// server-initiated requests, so sampling, elicitation and roots stay unavailable to the server.

export const MCP_MODERN_VERSION = '2026-07-28';
export const MCP_LEGACY_VERSION = '2025-06-18';
export const MCP_RESPONSE_CAP_BYTES = 2 * 1024 * 1024;

const META = 'io.modelcontextprotocol/';
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const PROBE_CAP_MS = 10_000;
const UNSUPPORTED_VERSION = -32022;
const METHOD_NOT_FOUND = -32601;

export type McpRequest = <T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
) => Promise<T>;

export class McpError extends Error {
  /** Set from the JSON-RPC error object, when the server sent one. */
  rpcCode?: number;
  rpcData?: unknown;
  /** Set for non-2xx replies (401/403 included). */
  httpStatus?: number;
  /** True when no HTTP exchange happened (refused, DNS, TLS, policy): another protocol would fail too. */
  network = false;
  /** The original error from `request`, for callers that classify transport failures. */
  override cause?: unknown;
  constructor(
    public readonly code: string,
    extra: Partial<
      Pick<McpError, 'rpcCode' | 'rpcData' | 'httpStatus' | 'network' | 'cause'>
    > = {},
  ) {
    super(code);
    this.name = 'McpError';
    Object.assign(this, extra);
  }
}

export type McpProtocol = '2025' | '2026';

export interface McpClientOptions {
  endpoint: string;
  request: McpRequest;
  /** Auth headers; never able to override the protocol headers (callers vet the names). */
  headers: Record<string, string>;
  /** Absolute epoch milliseconds; every request aborts at it. */
  deadline: number;
  maxResponseBytes: number;
  maxListPages: number;
  clientName: string;
  mode: 'auto' | McpProtocol;
  /** Mode seen last time; skips detection and is re-detected once if it fails with a version error. */
  remembered?: McpProtocol;
  /** Turns a request error into text that is safe to keep (fixed policy messages), or undefined. */
  safeMessage?: (error: Error) => string | undefined;
}

type Rec = Record<string, unknown>;
export function isRecord(value: unknown): value is Rec {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isResponseFor(message: unknown, id: number) {
  return (
    isRecord(message) &&
    message.id === id &&
    ('result' in message || 'error' in message)
  );
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new McpError('mcp_response_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readSse(
  response: Response,
  id: number,
  maxBytes: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new McpError('mcp_protocol_error');
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new McpError('mcp_response_too_large');
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      // Server-initiated requests and notifications are skipped, never answered.
      if (isResponseFor(parsed, id)) {
        await reader.cancel().catch(() => undefined);
        return parsed;
      }
    }
  }
  throw new McpError('mcp_protocol_error');
}

export function isVersionError(error: unknown): boolean {
  return (
    error instanceof McpError &&
    (error.rpcCode === UNSUPPORTED_VERSION ||
      error.rpcCode === METHOD_NOT_FOUND ||
      error.httpStatus === 400)
  );
}

function supportedVersions(value: unknown): string[] {
  const list = isRecord(value) ? value.supported : undefined;
  return Array.isArray(list)
    ? list.filter((v): v is string => typeof v === 'string').slice(0, 20)
    : [];
}

export class McpHttpClient {
  protocol: McpProtocol = '2025';
  protocolVersion = MCP_LEGACY_VERSION;
  serverName?: string;
  serverVersion?: string;
  readonly timings: { connectMs?: number; listMs?: number; callMs?: number } =
    {};
  private sessionId?: string;
  private nextId = 1;
  private canRedetect: boolean;

  private constructor(private readonly o: McpClientOptions) {
    this.canRedetect = !!o.remembered && o.mode === 'auto';
  }

  static async connect(o: McpClientOptions): Promise<McpHttpClient> {
    const client = new McpHttpClient(o);
    const started = Date.now();
    try {
      await client.negotiate();
    } catch (error) {
      await client.close();
      throw error;
    }
    client.timings.connectMs = Date.now() - started;
    return client;
  }

  private async negotiate(): Promise<void> {
    const { mode, remembered } = this.o;
    if (mode === '2025') return this.handshake();
    if (mode === '2026') return this.discover();
    if (!remembered) return this.detect();
    try {
      if (remembered === '2025') await this.handshake();
      else this.setModern(MCP_MODERN_VERSION);
    } catch (error) {
      if (!this.canRedetect || !isVersionError(error)) throw error;
      this.canRedetect = false;
      await this.detect();
    }
  }

  private setModern(version: string, result?: Rec) {
    this.protocol = '2026';
    this.protocolVersion = version;
    if (result) this.captureServerInfo(result);
  }

  private captureServerInfo(result: Rec) {
    const meta = isRecord(result._meta) ? result._meta : {};
    const info = isRecord(meta[`${META}serverInfo`])
      ? meta[`${META}serverInfo`]
      : result.serverInfo;
    if (!isRecord(info)) return;
    if (typeof info.name === 'string')
      this.serverName = info.name.slice(0, 128);
    if (typeof info.version === 'string')
      this.serverVersion = info.version.slice(0, 64);
  }

  /** Forced 2026: one discover, any failure is the failure. */
  private async discover(maxMs?: number) {
    const result = await this.call(true, 'server/discover', undefined, maxMs);
    this.setModern(MCP_MODERN_VERSION, result);
  }

  /** Auto: probe `server/discover`; only a clean modern answer or -32022 keeps us off the handshake. */
  private async detect(): Promise<void> {
    const remaining = Math.max(this.o.deadline - Date.now(), 0);
    const cap = Math.min(PROBE_CAP_MS, Math.max(Math.ceil(remaining / 3), 1));
    let versions: string[] | undefined;
    try {
      const result = await this.call(true, 'server/discover', undefined, cap);
      const listed = Array.isArray(result.supportedVersions)
        ? result.supportedVersions.filter(
            (v): v is string => typeof v === 'string',
          )
        : [];
      if (listed.length === 0 || listed.includes(MCP_MODERN_VERSION))
        return this.setModern(MCP_MODERN_VERSION, result);
      versions = listed;
    } catch (error) {
      if (!(error instanceof McpError)) throw error;
      if (
        error.code === 'mcp_credentials_rejected' ||
        error.code === 'mcp_response_too_large' ||
        error.network
      )
        throw error;
      // Do NOT fall back to initialize on -32022: the server speaks the modern revision.
      if (error.rpcCode === UNSUPPORTED_VERSION)
        versions = supportedVersions(error.rpcData);
    }
    // Any other error, a non-MCP reply or a probe timeout means a 2025 server.
    if (!versions) return this.handshake();
    return this.fallbackFor(versions);
  }

  private async fallbackFor(versions: string[]) {
    if (versions.includes(MCP_MODERN_VERSION))
      return this.setModern(MCP_MODERN_VERSION);
    if (versions.some((v) => v.startsWith('2025'))) return this.handshake();
    throw new McpError('mcp_unsupported_version');
  }

  private async handshake(): Promise<void> {
    this.protocol = '2025';
    this.protocolVersion = MCP_LEGACY_VERSION;
    const init = await this.call(false, 'initialize', {
      protocolVersion: MCP_LEGACY_VERSION,
      capabilities: {},
      clientInfo: { name: this.o.clientName, version: '1' },
    });
    this.protocolVersion =
      typeof init.protocolVersion === 'string' &&
      /^[0-9-]{8,12}$/.test(init.protocolVersion)
        ? init.protocolVersion
        : MCP_LEGACY_VERSION;
    this.captureServerInfo(init);
    await this.post(
      false,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      undefined,
    );
  }

  async listTools(
    stopAt = Infinity,
  ): Promise<{ tools: unknown[]; hasMore: boolean }> {
    const started = Date.now();
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < this.o.maxListPages; page += 1) {
      const result = await this.request(
        'tools/list',
        cursor ? { cursor } : undefined,
      );
      if (Array.isArray(result.tools))
        tools.push(...(result.tools as unknown[]));
      cursor =
        typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
      if (!cursor || tools.length >= stopAt) break;
    }
    this.timings.listMs = Date.now() - started;
    return { tools, hasMore: !!cursor };
  }

  async callTool(name: string, args: Rec): Promise<Rec> {
    if (!TOOL_NAME.test(name)) throw new McpError('mcp_invalid_tool_name');
    const started = Date.now();
    const result = await this.request('tools/call', { name, arguments: args });
    this.timings.callMs = Date.now() - started;
    // We never answer the server's follow-up request, so this call cannot complete.
    if (result.resultType === 'input_required')
      throw new McpError('mcp_input_required');
    return result;
  }

  /** One request on the negotiated protocol; a remembered mode that fails with a version error is re-detected once. */
  private async request(method: string, params?: Rec): Promise<Rec> {
    try {
      return await this.call(this.protocol === '2026', method, params);
    } catch (error) {
      if (!this.canRedetect || !isVersionError(error)) throw error;
      this.canRedetect = false;
      await this.close();
      this.sessionId = undefined;
      this.nextId = 1;
      await this.detect();
      return this.call(this.protocol === '2026', method, params);
    }
  }

  private async call(
    modern: boolean,
    method: string,
    params?: Rec,
    maxMs?: number,
  ): Promise<Rec> {
    const id = this.nextId++;
    const body: Rec = {
      jsonrpc: '2.0',
      id,
      method,
      ...(modern
        ? {
            params: {
              ...params,
              _meta: {
                [`${META}protocolVersion`]: MCP_MODERN_VERSION,
                [`${META}clientInfo`]: {
                  name: this.o.clientName,
                  version: '1',
                },
                [`${META}clientCapabilities`]: {},
              },
            },
          }
        : params
          ? { params }
          : {}),
    };
    const message = await this.post(modern, body, id, maxMs);
    if (!isResponseFor(message, id)) throw new McpError('mcp_protocol_error');
    const record = message as Rec;
    if (isRecord(record.error)) {
      const code =
        typeof record.error.code === 'number' ? record.error.code : 0;
      throw new McpError(`mcp_rpc_error_${code}`, {
        rpcCode: code,
        rpcData: record.error.data,
      });
    }
    if (!isRecord(record.result)) throw new McpError('mcp_protocol_error');
    return record.result;
  }

  private async post(
    modern: boolean,
    body: Rec,
    expectId?: number,
    maxMs?: number,
  ): Promise<unknown> {
    const remaining = this.o.deadline - Date.now();
    if (remaining <= 0) throw new McpError('mcp_timeout');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.o.headers,
    };
    if (modern) {
      headers['MCP-Protocol-Version'] = MCP_MODERN_VERSION;
      headers['Mcp-Method'] = String(body.method);
      const params = body.params as Rec | undefined;
      if (body.method === 'tools/call' && typeof params?.name === 'string')
        headers['Mcp-Name'] = params.name;
    } else {
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      if (body.method !== 'initialize')
        headers['MCP-Protocol-Version'] = this.protocolVersion;
    }
    try {
      return await this.o.request(
        this.o.endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(
            maxMs === undefined ? remaining : Math.min(remaining, maxMs),
          ),
        },
        (response) => this.read(response, expectId),
      );
    } catch (error) {
      throw this.toMcpError(error);
    }
  }

  private async read(response: Response, expectId?: number): Promise<unknown> {
    const status = response.status;
    if (status === 401 || status === 403)
      throw new McpError('mcp_credentials_rejected', { httpStatus: status });
    const session = response.headers.get('mcp-session-id');
    if (session && !this.sessionId && /^[\x21-\x7e]{1,256}$/.test(session))
      this.sessionId = session;
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!response.ok) {
      // A 400 may carry the JSON-RPC error (-32022 with the versions the server supports).
      if (expectId !== undefined && type.includes('application/json')) {
        try {
          const parsed = JSON.parse(
            await readCapped(response, this.o.maxResponseBytes),
          ) as unknown;
          if (isResponseFor(parsed, expectId)) return parsed;
        } catch {
          // fall through to the plain HTTP error
        }
      }
      throw new McpError(`mcp_http_${status}`, { httpStatus: status });
    }
    if (expectId === undefined) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (type.includes('text/event-stream'))
      return readSse(response, expectId, this.o.maxResponseBytes);
    if (!type.includes('application/json'))
      throw new McpError('mcp_protocol_error');
    const text = await readCapped(response, this.o.maxResponseBytes);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new McpError('mcp_protocol_error');
    }
  }

  private toMcpError(error: unknown): McpError {
    if (error instanceof McpError) return error;
    if (error instanceof Error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        return new McpError('mcp_timeout', { cause: error });
      const safe = this.o.safeMessage?.(error);
      if (safe) return new McpError(safe, { network: true, cause: error });
    }
    return new McpError('mcp_request_failed', { network: true, cause: error });
  }

  /** Best effort; servers expire idle sessions on their own. Only the 2025 path has a session. */
  async close(): Promise<void> {
    if (!this.sessionId || this.protocol === '2026') return;
    await this.o
      .request(
        this.o.endpoint,
        {
          method: 'DELETE',
          headers: {
            ...this.o.headers,
            'Mcp-Session-Id': this.sessionId,
            'MCP-Protocol-Version': this.protocolVersion,
          },
          signal: AbortSignal.timeout(2_000),
        },
        async (response) => {
          await response.body?.cancel().catch(() => undefined);
        },
      )
      .catch(() => undefined);
  }
}
