import type { LookupAddress } from 'node:dns';
import { Agent } from 'undici';
import {
  MCP_RESPONSE_CAP_BYTES,
  type McpRequest,
} from '../common/mcp/mcp-http-client';
import { resolvePublicAddresses } from '../common/utils/pinned-monitor-request';
import { allowInternalMonitorTargets } from '../common/utils/url-validator';
import {
  capResponseBody,
  createAgentPinnedLookup,
} from '../private-agent/private-agent-endpoint';

/** Fixed, secret-free refusal reasons; the check reports them as-is. */
export class McpPolicyError extends Error {}

export const MCP_REDIRECT_MESSAGE = 'Redirect not followed';

/**
 * Request function for MCP monitors. This is the monitor policy (private and link-local ranges
 * refused unless ALLOW_INTERNAL_TARGETS, metadata always refused, https only in the cloud), not the
 * private-agent policy. The host is resolved once per check, vetted, and every request connects to
 * that pinned address only, so DNS rebinding cannot swap in an internal address mid-check. Redirects
 * are an error: the Authorization header can never reach a second host. The agent is destroyed after
 * the body is read.
 */
export function createMcpMonitorRequest(): McpRequest {
  let resolved: Promise<LookupAddress[]> | undefined;
  let resolvedHost: string | undefined;

  return async <T>(
    input: string,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
  ): Promise<T> => {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new McpPolicyError('MCP URL must use https');
    if (url.username || url.password)
      throw new McpPolicyError('MCP URLs cannot include credentials');
    const internal = allowInternalMonitorTargets();
    if (url.protocol === 'http:' && !internal)
      throw new McpPolicyError('MCP URL must use https');

    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!resolved || resolvedHost !== host) {
      resolvedHost = host;
      resolved = resolvePublicAddresses(host, internal);
    }
    let addresses: LookupAddress[];
    try {
      addresses = await withSignal(resolved, init.signal);
    } catch (error) {
      // The vetting refusal is a fixed, secret-free message; other errors (DNS, abort) pass through.
      if (error instanceof Error && /private or reserved/.test(error.message))
        throw new McpPolicyError(error.message);
      throw error;
    }

    // The hostname stays in the URL for Host, SNI and certificate validation.
    const agent = new Agent({
      connect: { lookup: createAgentPinnedLookup(addresses[0]) },
    });
    try {
      let response: Response;
      try {
        response = await fetch(input, {
          ...init,
          redirect: 'error',
          dispatcher: agent,
        } as RequestInit);
      } catch (error) {
        const reason = (error as { cause?: { message?: unknown } }).cause
          ?.message;
        if (typeof reason === 'string' && /unexpected redirect/i.test(reason))
          throw new McpPolicyError(MCP_REDIRECT_MESSAGE);
        throw error;
      }
      // Backstop above the client's own 2 MiB cap, so the client's "too large" verdict wins.
      return await read(capResponseBody(response, MCP_RESPONSE_CAP_BYTES * 2));
    } finally {
      await agent.destroy();
    }
  };
}

/** dns.lookup cannot take a signal, so race it: a slow resolver must not outlive the check deadline. */
function withSignal<T>(
  work: Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  if (!signal) return work;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      const abort = () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException('aborted', 'AbortError'),
        );
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }),
  ]);
}
