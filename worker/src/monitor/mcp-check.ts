import type {
  McpFailure,
  McpResultDetails,
  MonitorConfig,
  MonitorResultDetails,
  MonitorResultStatus,
} from '../db/schema/types';
import {
  McpError,
  McpHttpClient,
  MCP_RESPONSE_CAP_BYTES,
  isRecord,
  type McpRequest,
} from '../common/mcp/mcp-http-client';
import { isDnsError } from '../common/utils/network-error';
import { scrubSecrets, secretEchoForms } from '../common/utils/scrub-secrets';
import { buildAuthHeaders } from '../private-agent/mcp-client';
import { McpPolicyError } from './mcp-monitor-transport';
import {
  MCP_NAME_MAX_CHARS,
  fingerprintTool,
  hashToolList,
} from './mcp-tool-diff';
import {
  SECRET_OVER_HTTP_MESSAGE,
  secretTransportAllowed,
} from './monitor-secret';
import type { MonitorSecretResult } from './monitor-secret';

export const MCP_DEFAULT_TIMEOUT_SECONDS = 30;
const MIN_TIMEOUT_SECONDS = 5;
const MAX_TIMEOUT_SECONDS = 60;
export const MCP_MAX_LIST_PAGES = 10;
export const MCP_MAX_TOOLS = 500;
const MAX_MESSAGE_CHARS = 300;

export interface McpCheckDeps {
  /** Monitor-policy transport; build one per check (`createMcpMonitorRequest`). */
  request: McpRequest;
  resolveSecret: (key: string) => Promise<MonitorSecretResult>;
}

export interface McpCheckResult {
  status: MonitorResultStatus;
  details: MonitorResultDetails & { mcp: McpResultDetails };
  responseTimeMs: number;
  isUp: boolean;
}

type Phase = 'connect' | 'list' | 'call';

const seconds = (ms: number) =>
  `${Math.round(ms / 100) / 10}`.replace(/\.0$/, '');

function resultText(result: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (
        isRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string'
      )
        parts.push(block.text);
    }
  }
  if (isRecord(result.structuredContent))
    parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n');
}

/**
 * One check of an MCP server: connect, list tools, optionally call one. Every message here is fixed
 * text or built from the user's own config; server-provided text (error messages, tool output)
 * is never copied into the result, and the resolved secret is scrubbed from all of it.
 */
export async function executeMcpCheck(
  target: string,
  config: MonitorConfig,
  deps: McpCheckDeps,
): Promise<McpCheckResult> {
  const started = Date.now();
  const mcp: McpResultDetails = {};
  const secrets: string[] = [];
  const totalLimitMs =
    Math.min(
      MAX_TIMEOUT_SECONDS,
      Math.max(
        MIN_TIMEOUT_SECONDS,
        config.timeoutSeconds ?? MCP_DEFAULT_TIMEOUT_SECONDS,
      ),
    ) * 1000;

  const finish = (
    status: MonitorResultStatus,
    failure?: McpFailure,
    message?: string,
  ): McpCheckResult => {
    const ms = Date.now() - started;
    if (failure) mcp.failure = failure;
    const details: MonitorResultDetails & { mcp: McpResultDetails } = {
      mcp,
      ...(message ? { errorMessage: message } : {}),
    };
    // Scrub before capping, so a cut can never leave part of a secret behind.
    const safe = scrubSecrets(details, secrets);
    if (safe.errorMessage)
      safe.errorMessage = safe.errorMessage.slice(0, MAX_MESSAGE_CHARS);
    return { status, details: safe, responseTimeMs: ms, isUp: status === 'up' };
  };

  const settings = config.mcp;
  if (!settings) return finish('error', undefined, 'MCP settings are missing');

  let headers: Record<string, string> = {};
  if (settings.auth.type !== 'none') {
    if (!settings.auth.secretKey)
      return finish(
        'error',
        'secret',
        'A project secret is required for this login',
      );
    if (settings.auth.type === 'header' && !settings.auth.headerName?.trim())
      return finish(
        'error',
        'secret',
        'A header name is required for this login',
      );
    if (!secretTransportAllowed(target))
      return finish('error', 'secret', SECRET_OVER_HTTP_MESSAGE);
    const secret = await deps.resolveSecret(settings.auth.secretKey);
    if (!secret.ok) return finish('error', 'secret', secret.message);
    secrets.push(...secretEchoForms(secret.value));
    try {
      headers = buildAuthHeaders({
        secret: secret.value,
        ...(settings.auth.type === 'header'
          ? { headerName: settings.auth.headerName }
          : {}),
      });
    } catch {
      return finish(
        'error',
        'secret',
        'The header name or secret cannot be sent',
      );
    }
  }

  let phase: Phase = 'connect';
  let client: McpHttpClient | undefined;
  const fail = (error: unknown): McpCheckResult => {
    if (client) {
      mcp.protocol = client.protocolVersion;
      Object.assign(mcp, client.timings);
    }
    if (!(error instanceof McpError))
      return finish('down', phase, 'Check failed');
    if (error.code === 'mcp_credentials_rejected')
      return finish(
        'down',
        'auth',
        `Login failed (${error.httpStatus ?? 401})`,
      );
    if (error.code === 'mcp_timeout')
      return finish(
        'timeout',
        'timeout',
        `Timed out after ${seconds(totalLimitMs)} s`,
      );
    if (phase === 'connect') {
      const cause = error.cause;
      if (cause instanceof McpPolicyError) {
        // A refused target (private range, plain http, credentials, redirect) is a config problem, not an outage.
        const redirect = cause.message === 'Redirect not followed';
        return finish(redirect ? 'down' : 'error', 'connect', cause.message);
      }
      if (error.code === 'mcp_unsupported_version')
        return finish('down', 'connect', 'No supported MCP protocol version');
      return finish(
        'down',
        'connect',
        isDnsError(cause)
          ? 'DNS lookup failed'
          : error.code === 'mcp_response_too_large'
            ? 'Reply too large'
            : 'Could not connect to an MCP server',
      );
    }
    const detail =
      error.code === 'mcp_response_too_large'
        ? ': reply too large'
        : error.rpcCode !== undefined
          ? ` (error ${error.rpcCode})`
          : '';
    if (phase === 'list')
      return finish('down', 'list', `Could not list tools${detail}`);
    return finish('down', 'call', `Tool call failed${detail}`);
  };

  try {
    client = await McpHttpClient.connect({
      endpoint: target,
      request: deps.request,
      headers,
      deadline: started + totalLimitMs,
      maxResponseBytes: MCP_RESPONSE_CAP_BYTES,
      maxListPages: MCP_MAX_LIST_PAGES,
      clientName: 'supercheck-monitor',
      mode: settings.protocol ?? 'auto',
      remembered: config.mcpState?.detectedProtocol,
      safeMessage: (error) =>
        error instanceof McpPolicyError ? error.message : undefined,
    });
    mcp.protocol = client.protocolVersion;
    if (client.serverName) mcp.serverName = client.serverName;
    if (client.serverVersion) mcp.serverVersion = client.serverVersion;

    phase = 'list';
    const { tools: raw } = await client.listTools();
    const byName = new Map<string, string>();
    for (const tool of raw) {
      const fingerprint = fingerprintTool(tool);
      if (fingerprint) byName.set(fingerprint.name, fingerprint.fingerprint);
    }
    // Sorted before the cap, so a server listing more than the cap in a shifting order stays stable.
    const tools = [...byName]
      .map(([name, fingerprint]) => ({ name, fingerprint }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, MCP_MAX_TOOLS);
    mcp.toolCount = byName.size;
    mcp.toolsHash = hashToolList(tools);
    mcp.tools = tools;
    Object.assign(mcp, client.timings);
    // A remembered mode that was re-detected during the list changes the protocol and server info.
    mcp.protocol = client.protocolVersion;
    if (client.serverName) mcp.serverName = client.serverName;
    if (client.serverVersion) mcp.serverVersion = client.serverVersion;

    const missing = (settings.requiredTools ?? []).filter(
      (name) => !byName.has(name.slice(0, MCP_NAME_MAX_CHARS)),
    );
    if (missing.length > 0) {
      return finish(
        'down',
        'required_tool',
        missing.length === 1
          ? `Tool ${missing[0]} is missing`
          : `Tools ${missing.join(', ')} are missing`,
      );
    }

    if (settings.toolCall) {
      phase = 'call';
      const call = settings.toolCall;
      let result: Record<string, unknown>;
      try {
        result = await client.callTool(call.name, call.arguments ?? {});
      } finally {
        Object.assign(mcp, client.timings);
      }
      if (result.isError === true)
        return finish('down', 'call', `Tool ${call.name} returned an error`);
      if (
        call.expectText &&
        !resultText(result)
          .toLowerCase()
          .includes(call.expectText.toLowerCase())
      )
        return finish(
          'down',
          'assert',
          'Result did not contain the expected text',
        );
    }
    return finish('up');
  } catch (error) {
    return fail(error);
  } finally {
    await client?.close();
  }
}
