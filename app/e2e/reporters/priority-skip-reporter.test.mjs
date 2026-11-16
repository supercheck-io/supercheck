import assert from 'node:assert/strict';
import { test } from 'node:test';
import PrioritySkipReporter, { ENV_GATED } from './priority-skip-reporter.ts';

const tc = (title, annotations = []) => ({ titlePath: () => ['', title], annotations });
const quiet = async (fn) => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { warn, error }); }
};

test('a skipped @critical test fails the run', async () => {
  const r = new PrioritySkipReporter();
  r.onTestEnd(tc('x @critical'), { status: 'skipped' });
  assert.deepEqual(await quiet(() => r.onEnd({})), { status: 'failed' });
});

test('an env-gated skipped @high test only warns', async () => {
  const r = new PrioritySkipReporter();
  r.onTestEnd(tc('x @high', [{ type: ENV_GATED, description: 'needs a stub' }, { type: 'skip', description: 'needs a stub' }]), { status: 'skipped' });
  r.onTestEnd(tc('y @medium'), { status: 'skipped' });
  assert.deepEqual(await quiet(() => r.onEnd({})), {});
});

test('an env-gated skip does not hide an ungated one', async () => {
  const r = new PrioritySkipReporter();
  r.onTestEnd(tc('x @high', [{ type: ENV_GATED, description: 'g' }, { type: 'skip', description: 'g' }]), { status: 'skipped' });
  r.onTestEnd(tc('y @critical'), { status: 'skipped' });
  assert.deepEqual(await quiet(() => r.onEnd({})), { status: 'failed' });
});

test('a different skip inside an env-gated describe still fails', async () => {
  const r = new PrioritySkipReporter();
  r.onTestEnd(tc('x @high', [{ type: ENV_GATED, description: 'needs a stub' }, { type: 'fixme', description: 'flaky' }]), { status: 'skipped' });
  assert.deepEqual(await quiet(() => r.onEnd({})), { status: 'failed' });
});
