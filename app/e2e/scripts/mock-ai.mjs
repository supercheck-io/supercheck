#!/usr/bin/env node
// A stand-in for the OpenAI Responses API, for the PR screenshot app only.
//
// The throwaway app in .github/workflows/pr-screenshots.yml has no AI key (fork PRs get no
// secrets), so Copilot, incident briefs and AI test tools would only show "unavailable".
// Pointing OPENAI_BASE_URL here makes them render canned, deterministic answers instead.
// Structured-output calls get an object built from the request's JSON schema.
//
//   node mock-ai.mjs [port]        listens on 127.0.0.1 (default 4010)

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ANSWER = [
  '**Likely cause:** p95 latency on `checkout-api` rose from 180 ms to 2.4 s right after the 14:00 deploy.',
  '',
  '**Evidence**',
  '- The *Marketing site* monitor failed 2 checks (HTTP 503) between 13:20 and 14:00.',
  '- The *Nightly regression* job failed on the "Place order" step.',
  '- No infrastructure alerts fired in the same window.',
  '',
  '**Next checks**',
  '1. Compare the 14:00 release diff for the payment client timeout.',
  '2. Roll back `checkout-api` if latency stays above 1 s for 10 more minutes.',
].join('\n');

const TEXT = 'Checkout latency rose after the 14:00 deploy of checkout-api; rolling back restores normal response times.';

/** Builds a value that satisfies a JSON schema, preferring readable demo values. */
export function sample(schema, defs = {}, key = '', depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 12) return null;
  const all = { ...defs, ...(schema.$defs ?? {}), ...(schema.definitions ?? {}) };
  if (schema.$ref) return sample(all[schema.$ref.split('/').pop()], all, key, depth + 1);
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const options = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(options)) return sample(options.find((o) => o?.type !== 'null') ?? options[0], all, key, depth + 1);
  if (Array.isArray(schema.allOf)) return Object.assign({}, ...schema.allOf.map((s) => sample(s, all, key, depth + 1)));
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const out = {};
      for (const [name, prop] of Object.entries(schema.properties ?? {})) out[name] = sample(prop, all, name, depth + 1);
      return out;
    }
    case 'array': {
      const n = Math.min(Math.max(schema.minItems ?? 2, 1), schema.maxItems ?? 2);
      return Array.from({ length: n }, () => sample(schema.items, all, key, depth + 1));
    }
    case 'integer':
    case 'number': {
      const min = schema.minimum ?? schema.exclusiveMinimum ?? 0;
      const max = schema.maximum ?? schema.exclusiveMaximum ?? (/confidence|score|probability/i.test(key) ? 1 : 100);
      const value = /confidence|score|probability/i.test(key) ? Math.min(max, Math.max(min, 0.82)) : Math.min(max, Math.max(min, 3));
      return type === 'integer' ? Math.round(value) : value;
    }
    case 'boolean':
      return false;
    case 'string': {
      if (schema.format === 'date-time') return '2026-01-01T12:00:00.000Z';
      if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com/';
      if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      const text = /title|name|label|headline/i.test(key) ? 'Checkout latency after the 14:00 deploy' : TEXT;
      return schema.maxLength ? text.slice(0, schema.maxLength) : text;
    }
    default:
      return null;
  }
}

/** The text a request should get: JSON for structured output, the canned answer otherwise. */
export function answerFor(body) {
  const format = body?.text?.format;
  if (format?.type === 'json_schema' && format.schema) return JSON.stringify(sample(format.schema));
  if (format?.type === 'json_object') return JSON.stringify({ summary: TEXT });
  return ANSWER;
}

const usage = { input_tokens: 120, output_tokens: 80, total_tokens: 200 };

export function responseFor(body) {
  return {
    id: 'resp_demo',
    object: 'response',
    created_at: 1767268800,
    model: body?.model ?? 'demo',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', id: 'msg_demo', status: 'completed', content: [{ type: 'output_text', text: answerFor(body), annotations: [] }] }],
    usage,
  };
}

export function streamFor(body) {
  const text = answerFor(body);
  const events = [
    { type: 'response.created', response: { id: 'resp_demo', created_at: 1767268800, model: body?.model ?? 'demo' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_demo' } },
    // A few deltas, so streaming UIs render the way they do with a real model.
    ...(text.match(/[\s\S]{1,80}/g) ?? ['']).map((delta) => ({ type: 'response.output_text.delta', item_id: 'msg_demo', delta })),
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_demo' } },
    { type: 'response.completed', response: { usage } },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function serve(port) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/responses')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Only /v1/responses is mocked', type: 'not_found', code: 'not_found' } }));
        return;
      }
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        // An unreadable body still gets the canned answer.
      }
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }).end(streamFor(body));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(responseFor(body)));
      }
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`Mock AI listening on http://127.0.0.1:${port}/v1`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) serve(Number(process.argv[2] ?? 4010));
