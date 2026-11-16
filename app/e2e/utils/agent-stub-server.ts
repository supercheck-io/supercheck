import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface AgentStubServer {
  /** Port the stub listens on (all interfaces), so a worker in a container can reach it. */
  port: number;
  /** Number of chat requests served, to prove the worker really called it. */
  requests: () => number;
  close: () => Promise<void>;
}

/**
 * A minimal OpenAI-compatible chat completions endpoint. A prompt that mentions "refund" gets the policy and a
 * `lookup_policy` tool call; any other prompt gets an answer without the policy.
 */
export async function startAgentStub(): Promise<AgentStubServer> {
  let served = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      served += 1;
      let prompt = '';
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages?: Array<{ content?: string }> };
        prompt = String(body.messages?.at(-1)?.content ?? '');
      } catch {
        res.writeHead(400).end();
        return;
      }
      const refund = /refund/i.test(prompt);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'chatcmpl-e2e',
          object: 'chat.completion',
          model: 'e2e-agent',
          choices: [
            {
              index: 0,
              finish_reason: refund ? 'tool_calls' : 'stop',
              message: {
                role: 'assistant',
                content: refund ? 'Refunds are accepted within 30 days.' : 'I can only help with orders.',
                ...(refund ? { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup_policy', arguments: '{}' } }] } : {}),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests: () => served,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
