import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface McpStubServer {
  /** Port the stub listens on (all interfaces), so a worker in a container can reach it. */
  port: number;
  /** Number of JSON-RPC requests served, to prove the worker really called it. */
  requests: () => number;
  close: () => Promise<void>;
}

export const STUB_TOOLS = [
  { name: 'echo', description: 'Echo the input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'get_time', description: 'Current time', inputSchema: { type: 'object' } },
];

/**
 * A minimal MCP server over HTTP (2025 handshake: initialize, notifications/initialized, tools/list, tools/call).
 * `token` is the Bearer token it accepts; any other request gets 401.
 */
export async function startMcpStub(token: string): Promise<McpStubServer> {
  let served = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      served += 1;
      let message: { id?: number | string; method?: string };
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (message.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const reply = (result: unknown, headers: Record<string, string> = {}) =>
        res
          .writeHead(200, { 'content-type': 'application/json', ...headers })
          .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      switch (message.method) {
        case 'initialize':
          reply(
            { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'e2e-stub', version: '1.0.0' } },
            { 'mcp-session-id': 'e2e-session' },
          );
          return;
        case 'tools/list':
          reply({ tools: STUB_TOOLS });
          return;
        case 'tools/call':
          reply({ content: [{ type: 'text', text: 'ok' }] });
          return;
        default:
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests: () => served,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
