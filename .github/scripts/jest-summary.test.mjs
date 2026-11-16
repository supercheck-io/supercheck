import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_FAILURES, cell, render } from './jest-summary.mjs';

const ROOT = '/repo/app';

function results({ failed = [], brokenSuite = false } = {}) {
  const testResults = [
    {
      name: `${ROOT}/src/a.spec.ts`,
      status: failed.length ? 'failed' : 'passed',
      endTime: 61_000,
      assertionResults: [
        { fullName: 'a works', status: 'passed' },
        ...failed.map((fullName) => ({ fullName, status: 'failed' })),
      ],
    },
  ];
  if (brokenSuite) {
    testResults.push({ name: `${ROOT}/src/b.spec.ts`, status: 'failed', endTime: 2000, assertionResults: [] });
  }
  return {
    success: !failed.length && !brokenSuite,
    startTime: 1000,
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: failed.length ? 0 : 1,
    numFailedTestSuites: (failed.length ? 1 : 0) + (brokenSuite ? 1 : 0),
    numRuntimeErrorTestSuites: brokenSuite ? 1 : 0,
    numPendingTestSuites: 0,
    numTotalTests: 2 + failed.length,
    numPassedTests: 1,
    numFailedTests: failed.length,
    numPendingTests: 1,
    numTodoTests: 0,
    testResults,
  };
}

test('passing run shows counts, duration and coverage', () => {
  const md = render({
    title: 'App tests',
    results: results(),
    coverage: { total: { lines: { pct: 55.5, covered: 555, total: 1000 }, branches: { pct: 40, covered: 4, total: 10 } } },
    outcome: 'success',
    artifactUrl: 'https://github.com/o/r/actions/runs/1/artifacts/2',
    root: ROOT,
  });
  assert.match(md, /^## ✅ App tests/);
  assert.match(md, /\*\*Tests:\*\* ✅ 1 passed · ⏭️ 1 skipped · 2 total/);
  assert.match(md, /\*\*Duration:\*\* 1m 0s/);
  assert.match(md, /\| Lines \| 55\.5% \| 555 \/ 1000 \|/);
  assert.match(md, /\[Download the coverage report\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/2\)/);
  assert.doesNotMatch(md, /Failed tests/);
});

test('failures are listed with relative paths and escaped names', () => {
  const md = render({ title: 'T', results: results({ failed: ['x | <b>y</b>\nz'], brokenSuite: true }), outcome: 'failure', root: ROOT });
  assert.match(md, /^## ❌ T/);
  assert.ok(md.includes('| src/a.spec.ts | x \\| &lt;b&gt;y&lt;/b&gt; z |'), md);
  assert.ok(md.includes('| src/b.spec.ts | _suite failed to run_ |'), md);
  assert.match(md, /❌ 2 failed/);
});

test('failure list is capped', () => {
  const failed = Array.from({ length: MAX_FAILURES + 5 }, (_, i) => `t${i}`);
  const md = render({ title: 'T', results: results({ failed }), outcome: 'failure', root: ROOT });
  assert.equal(md.split('\n').filter((l) => l.startsWith('| src/a.spec.ts |')).length, MAX_FAILURES);
  assert.match(md, /…and 5 more/);
});

test('a failed step with green tests points at the log', () => {
  const md = render({ title: 'T', results: results(), outcome: 'failure', root: ROOT });
  assert.match(md, /^## ❌ T/);
  assert.match(md, /coverage threshold or leaked handle/);
});

test('missing results still render', () => {
  const md = render({ title: 'T', results: null, outcome: 'failure' });
  assert.match(md, /No Jest results were written/);
});

test('test names cannot inject markdown, links or the suite marker', () => {
  const md = render({ title: 'T', results: results({ failed: ['_x_ ![i](https://e.x/p.png) [l](https://e.x) `c`'] }), outcome: 'failure', root: ROOT });
  assert.ok(md.includes('\\_x\\_ \\!\\[i\\]\\(https://e.x/p.png\\) \\[l\\]\\(https://e.x\\) \\`c\\`'), md);
  assert.doesNotMatch(md, /_suite failed to run_/);
});

test('a skipped test step says not run', () => {
  const md = render({ title: 'T', results: null, outcome: 'skipped' });
  assert.match(md, /^## ⏭️ T\n\nNot run/);
});

test('cell truncates long names', () => {
  assert.equal(cell('a'.repeat(300)).length, 200);
});
