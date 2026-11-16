// Writes a Jest run (--json output plus coverage-summary.json) to the GitHub job summary.
// Env: SUMMARY_TITLE, JEST_RESULTS, COVERAGE_SUMMARY, TEST_OUTCOME, ARTIFACT_URL.
// Never fails the job: a summary is a report, the test step owns the result.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FAILURES = 20;

// Test names come from pull request code, so keep them inert inside a table cell.
export function cell(text, max = 200) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return cut
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]()!#~|]/g, '\\$&');
}

function readJson(file) {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function counts({ passed, failed, skipped, total }) {
  const parts = [`✅ ${passed} passed`];
  if (failed) parts.push(`❌ ${failed} failed`);
  if (skipped) parts.push(`⏭️ ${skipped} skipped`);
  return `${parts.join(' · ')} · ${total} total`;
}

export function render({ title, results, coverage, outcome, artifactUrl, root = process.cwd() }) {
  if (outcome === 'skipped') return `## ⏭️ ${cell(title)}\n\nNot run: an earlier step failed.\n`;
  const ok = outcome ? outcome === 'success' : results?.success === true;
  const lines = [`## ${ok ? '✅' : '❌'} ${cell(title)}`, ''];

  if (!results) {
    lines.push('No Jest results were written: the tests did not start or the step timed out. See the job log.');
  } else {
    const end = Math.max(results.startTime, ...results.testResults.map((r) => r.endTime ?? 0));
    lines.push(
      `- **Test files:** ${counts({ passed: results.numPassedTestSuites, failed: results.numFailedTestSuites, skipped: results.numPendingTestSuites, total: results.numTotalTestSuites })}`,
      `- **Tests:** ${counts({ passed: results.numPassedTests, failed: results.numFailedTests, skipped: results.numPendingTests + results.numTodoTests, total: results.numTotalTests })}`,
      `- **Duration:** ${duration(end - results.startTime)}`,
    );

    const failures = [];
    for (const suite of results.testResults) {
      const file = path.relative(root, suite.name);
      const failedTests = suite.assertionResults.filter((t) => t.status === 'failed');
      if (suite.status === 'failed' && failedTests.length === 0) failures.push([file, null]);
      for (const t of failedTests) failures.push([file, t.fullName]);
    }
    if (failures.length) {
      lines.push('', '### Failed tests', '', '| File | Test |', '| --- | --- |');
      for (const [file, name] of failures.slice(0, MAX_FAILURES)) {
        lines.push(`| ${cell(file)} | ${name === null ? '_suite failed to run_' : cell(name)} |`);
      }
      if (failures.length > MAX_FAILURES) lines.push('', `…and ${failures.length - MAX_FAILURES} more; see the job log.`);
    }
    if (!ok && !failures.length) {
      lines.push('', 'Every test passed, but the step failed: check the job log for a coverage threshold or leaked handle.');
    }
  }

  const total = coverage?.total;
  if (total) {
    lines.push('', '### Coverage', '', '| Metric | % | Covered / total |', '| --- | ---: | ---: |');
    for (const key of ['lines', 'branches', 'functions', 'statements']) {
      const m = total[key];
      if (m) lines.push(`| ${key[0].toUpperCase()}${key.slice(1)} | ${m.pct}% | ${m.covered} / ${m.total} |`);
    }
  }
  if (artifactUrl) lines.push('', `📦 [Download the coverage report](${artifactUrl})`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { SUMMARY_TITLE, JEST_RESULTS, COVERAGE_SUMMARY, TEST_OUTCOME, ARTIFACT_URL, GITHUB_STEP_SUMMARY } = process.env;
    const markdown = render({
      title: SUMMARY_TITLE || 'Jest',
      results: readJson(JEST_RESULTS),
      coverage: readJson(COVERAGE_SUMMARY),
      outcome: TEST_OUTCOME,
      artifactUrl: /^https:\/\//.test(ARTIFACT_URL ?? '') ? ARTIFACT_URL : '',
    });
    if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `${markdown}\n`);
    else process.stdout.write(markdown);
  } catch (error) {
    console.log(`::warning::Could not write the test summary: ${error.message}`);
  }
}
