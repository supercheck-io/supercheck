import { promises as fs } from 'fs';
import * as path from 'path';

/** One agent test as stored in runs.metadata.agent.tests. Transcripts stay in the report, never here. */
export interface AgentTestSummary {
  testId: string;
  title: string;
  attempts: number;
  passed: number;
  passRate: number;
  totalTokens: number;
  judgeTokens: number;
  cost?: number;
  toolNames: string[];
  durationMs: number;
  slowestMs: number;
  failures: { attempt: number; message: string }[];
}

export const AGENT_SUMMARY_ATTACHMENT = 'agent-summary';
const CONTAINER_REPORTS_DIR = '/tmp/playwright-reports';
const MAX_TESTS = 20;
const MAX_TOOL_NAMES = 50;
const MAX_FAILURES = 5;
const MAX_METADATA_BYTES = 8 * 1024;
// A summary holds at most 20 transcript entries of 4 KiB each; a bigger file is not ours.
const MAX_FILE_BYTES = 512 * 1024;

type Redact = (text: string) => string;
// Redact before clipping so a secret cut at the boundary cannot survive in part.
const clip = (v: unknown, max: number, redact: Redact) =>
  redact(typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(
    0,
    max,
  );
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** `NNN-<id>.agent.spec.ts` (job) or `<id>.agent.spec.ts` (single) -> id. */
export function testIdFromSpecFile(file: string): string | undefined {
  return file
    .split(/[\\/]/)
    .pop()
    ?.match(/^(?:\d{3}-)?(.+?)\.agent\.spec\.ts$/)?.[1];
}

function sanitize(
  testId: string,
  raw: unknown,
  redact: Redact,
): AgentTestSummary {
  const s = rec(raw);
  const attempts = Math.max(0, Math.round(num(s.attempts)));
  const passed = Math.min(attempts, Math.max(0, Math.round(num(s.passed))));
  return {
    testId,
    title: clip(s.title, 200, redact),
    attempts,
    passed,
    passRate: attempts ? passed / attempts : 0,
    totalTokens: num(s.totalTokens),
    judgeTokens: num(s.judgeTokens),
    ...(typeof s.cost === 'number' && Number.isFinite(s.cost)
      ? { cost: s.cost }
      : {}),
    toolNames: (Array.isArray(s.toolNames) ? s.toolNames : [])
      .slice(0, MAX_TOOL_NAMES)
      .map((n) => clip(n, 100, redact)),
    durationMs: num(s.durationMs),
    slowestMs: num(s.slowestMs),
    failures: (Array.isArray(s.failures) ? s.failures : [])
      .slice(0, MAX_FAILURES)
      .map((f) => ({
        attempt: num(rec(f).attempt),
        message: clip(rec(f).message, 200, redact),
      })),
  };
}

/**
 * Reads the agent-summary attachments recorded in results.json. Playwright's JSON reporter stores a
 * path attachment as { name, contentType, path } with the pod path (/tmp/playwright-reports/...), and the
 * pod's report dir is what extractedReportsDir holds, so the path maps by its prefix. Anything missing,
 * oversized or malformed is skipped: the run result never depends on this.
 */
export async function readAgentSummaries(
  report: unknown,
  extractedReportsDir: string,
  redact: Redact = (t) => t,
): Promise<AgentTestSummary[]> {
  const found: { testId: string; file: string }[] = [];
  const visit = (node: unknown, file?: string) => {
    const obj = rec(node);
    const currentFile = typeof obj.file === 'string' ? obj.file : file;
    const testId = currentFile && testIdFromSpecFile(currentFile);
    if (testId && Array.isArray(obj.tests))
      for (const test of obj.tests) {
        const results = rec(test).results;
        // retries are 0 for agent specs; the last result is the one that ran last anyway
        const last = Array.isArray(results)
          ? rec(results[results.length - 1])
          : {};
        const attachment = (
          Array.isArray(last.attachments) ? last.attachments : []
        )
          .map(rec)
          .find(
            (a) =>
              a.name === AGENT_SUMMARY_ATTACHMENT && typeof a.path === 'string',
          );
        if (attachment) found.push({ testId, file: attachment.path as string });
      }
    for (const key of ['suites', 'projects', 'specs'])
      if (Array.isArray(obj[key]))
        (obj[key] as unknown[]).forEach((c) => visit(c, currentFile));
  };
  visit(report);

  const tests: AgentTestSummary[] = [];
  for (const { testId, file } of found.slice(0, MAX_TESTS)) {
    try {
      const rel = path.posix.relative(CONTAINER_REPORTS_DIR, file);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const hostPath = path.join(extractedReportsDir, rel);
      if (path.relative(extractedReportsDir, hostPath).startsWith('..'))
        continue;
      const st = await fs.lstat(hostPath);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      tests.push(
        sanitize(
          testId,
          JSON.parse(await fs.readFile(hostPath, 'utf8')),
          redact,
        ),
      );
    } catch {
      // missing or malformed: leave this test without agent numbers
    }
  }
  return tests;
}

/** runs.metadata.agent, or undefined when there is nothing to store. Drops trailing tests to stay under 8 KiB. */
export function agentMetadata(
  tests: AgentTestSummary[],
): { tests: AgentTestSummary[] } | undefined {
  const kept = tests.slice(0, MAX_TESTS);
  while (
    kept.length &&
    Buffer.byteLength(JSON.stringify({ tests: kept })) > MAX_METADATA_BYTES
  )
    kept.pop();
  return kept.length ? { tests: kept } : undefined;
}
