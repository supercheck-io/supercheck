import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createAgent, newState, type AgentState } from './agent';
import { redact } from './clients';
import type { Agent } from './types';

export * from './types';
export { expect };

const TEXT_CLIP = 4096;
const TRANSCRIPT_ENTRIES = 20;
const TOOL_NAMES = 50;
const FAILURES = 5;
const FAILURE_CLIP = 200;

// Redact first: a key cut at the clip boundary would otherwise survive in part.
const clip = (text: string, max: number, secrets: string[]) => {
  const t = redact(text, secrets);
  return t.length > max ? `${t.slice(0, max)}...` : t;
};

/** The summary the worker reads from results.json. `raw` replies are never in it. */
export function buildSummary(
  title: string,
  state: AgentState,
  passedWithoutRepeat: boolean,
) {
  const repeats = state.repeats;
  const attempts = repeats.length
    ? repeats.reduce((s, r) => s + r.attempts, 0)
    : 1;
  const passed = repeats.length
    ? repeats.reduce((s, r) => s + r.passed, 0)
    : passedWithoutRepeat
      ? 1
      : 0;
  const costs = state.sends.flatMap((s) =>
    s.cost === undefined ? [] : [s.cost],
  );
  const durations = state.sends.map((s) => s.durationMs);
  return {
    title,
    attempts,
    passed,
    passRate: passed / attempts,
    totalTokens: state.sends.reduce((s, x) => s + x.tokens, 0),
    judgeTokens: state.judgeTokens,
    ...(costs.length ? { cost: costs.reduce((a, b) => a + b, 0) } : {}),
    toolNames: [...new Set(state.sends.flatMap((s) => s.toolNames))].slice(
      0,
      TOOL_NAMES,
    ),
    durationMs: durations.reduce((a, b) => a + b, 0),
    slowestMs: Math.max(0, ...durations),
    failures: repeats
      .flatMap((r) => r.failures)
      .slice(0, FAILURES)
      .map((f) => ({
        attempt: f.attempt,
        message: clip(f.message, FAILURE_CLIP, state.secrets),
      })),
    transcript: state.sends.slice(0, TRANSCRIPT_ENTRIES).map((s) => ({
      attempt: s.attempt,
      prompt: clip(s.prompt, TEXT_CLIP, state.secrets),
      reply: clip(
        s.error ? `error: ${s.error}` : s.reply,
        TEXT_CLIP,
        state.secrets,
      ),
    })),
  };
}

/** Plain UTF-8 JSON with every secret removed from each string value (never from the serialized text, which would corrupt numbers). */
export function redactedJson(value: unknown, secrets: string[]): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'string' ? redact(v, secrets) : v,
  );
}

export const test = base.extend<{ agent: Agent }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  agent: async ({}, use, testInfo) => {
    const state = newState();
    await use(createAgent(state));
    // After the test body: the summary must never fail the test, and needs no secret to be known to Supercheck.
    try {
      const summary = buildSummary(
        testInfo.title,
        state,
        testInfo.status === 'passed',
      );
      const path = testInfo.outputPath('agent-summary.json');
      await writeFile(path, redactedJson(summary, state.secrets), 'utf8');
      // By path: a body is base64 in results.json, which the report scrub cannot read.
      await testInfo.attach('agent-summary', {
        path,
        contentType: 'application/json',
      });
    } catch {
      // The run result stays as the script's own assertions made it.
    }
  },
});
