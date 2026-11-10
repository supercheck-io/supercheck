import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerFor, responseFor, sample, streamFor } from './mock-ai.mjs';

test('schema samples respect types, enums and array bounds', () => {
  const value = sample({
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 10 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      severity: { enum: ['sev2', 'sev1'] },
      steps: { type: 'array', minItems: 3, items: { $ref: '#/$defs/step' } },
      one: { type: 'array', maxItems: 1, items: { type: 'integer' } },
      owner: { anyOf: [{ type: 'null' }, { type: 'string' }] },
    },
    $defs: { step: { type: 'object', properties: { done: { type: 'boolean' } } } },
  });
  assert.equal(value.title.length <= 10, true);
  assert.equal(value.confidence, 0.82);
  assert.equal(value.severity, 'sev2');
  assert.deepEqual(value.steps, [{ done: false }, { done: false }, { done: false }]);
  assert.equal(value.one.length, 1);
  assert.equal(typeof value.owner, 'string');
});

test('answers pick JSON for structured output and post-mortems, text otherwise', () => {
  assert.deepEqual(Object.keys(JSON.parse(answerFor({ text: { format: { type: 'json_schema', schema: { type: 'object', properties: { a: { type: 'string' } } } } } }))), ['a']);
  assert.ok('root_cause' in JSON.parse(answerFor({ instructions: 'You write blameless post-mortem drafts' })));
  assert.match(answerFor({ input: 'Why is checkout slow?' }), /Likely cause/);
  assert.equal(responseFor({}).output[0].content[0].type, 'output_text');
  const events = streamFor({}).split('\n\n').filter(Boolean).map((chunk) => JSON.parse(chunk.split('\ndata: ')[1]).type);
  assert.equal(events[0], 'response.created');
  assert.equal(events.at(-1), 'response.completed');
});
