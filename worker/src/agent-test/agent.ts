import { AsyncLocalStorage } from 'node:async_hooks';
import { stripVTControlCharacters } from 'node:util';
import { chatCompletion, createClient, secretsOf } from './clients';
import type { Agent, AgentJudgeResult, AgentRepeatResult } from './types';

export const REPEAT_BUDGET_MS = 200_000;

export interface SentRecord {
  attempt: number;
  prompt: string;
  reply: string;
  error?: string;
  durationMs: number;
  tokens: number;
  cost?: number;
  toolNames: string[];
}

/** What one test did; the fixture turns it into agent-summary.json. */
export interface AgentState {
  sends: SentRecord[];
  judgeTokens: number;
  repeats: AgentRepeatResult[];
  /** Keys and header values seen by connect/judge; removed from the summary. */
  secrets: string[];
}

export const newState = (): AgentState => ({
  sends: [],
  judgeTokens: 0,
  repeats: [],
  secrets: [],
});

// Playwright's expect() messages carry terminal colour codes, which are noise in a summary.
const message = (e: unknown) =>
  stripVTControlCharacters(e instanceof Error ? e.message : String(e));

export function createAgent(state: AgentState): Agent {
  // Concurrent attempts each see their own number, so a transcript line knows its attempt.
  const attemptOf = new AsyncLocalStorage<number>();

  return {
    connect(options) {
      state.secrets.push(...secretsOf(options));
      const client = createClient(options);
      return {
        async send(prompt, sendOptions) {
          const base = { attempt: attemptOf.getStore() ?? 0, prompt };
          try {
            const r = await client.send(prompt, sendOptions);
            state.sends.push({
              ...base,
              reply: r.text,
              durationMs: r.durationMs,
              tokens: r.usage.totalTokens,
              cost: r.usage.cost,
              toolNames: r.toolNames,
            });
            return r;
          } catch (error) {
            state.sends.push({
              ...base,
              reply: '',
              error: message(error),
              durationMs: 0,
              tokens: 0,
              toolNames: [],
            });
            throw error;
          }
        },
      };
    },

    async repeat(n, fn, options) {
      const concurrency = options?.concurrency ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > 20)
        throw new RangeError('agent.repeat: n must be an integer from 1 to 20');
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5)
        throw new RangeError(
          'agent.repeat: concurrency must be an integer from 1 to 5',
        );
      const startedAt = Date.now();
      const failures: AgentRepeatResult['failures'] = [];
      let next = 0;
      const lane = async () => {
        while (next < n) {
          const attempt = ++next;
          if (Date.now() - startedAt >= REPEAT_BUDGET_MS) {
            failures.push({ attempt, message: 'not run: time budget used' });
            continue;
          }
          try {
            await attemptOf.run(attempt, fn);
          } catch (error) {
            failures.push({ attempt, message: message(error) });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, lane));
      failures.sort((a, b) => a.attempt - b.attempt);
      const result: AgentRepeatResult = {
        attempts: n,
        passed: n - failures.length,
        failed: failures.length,
        passRate: (n - failures.length) / n,
        failures,
      };
      state.repeats.push(result);
      return result;
    },

    async judge(text, rubric, options) {
      state.secrets.push(...secretsOf(options));
      const r = await chatCompletion(
        options,
        [
          {
            role: 'system',
            content:
              'You grade a text against a rubric. Reply with only JSON: {"pass": true|false, "reason": "<one sentence>"}.',
          },
          { role: 'user', content: `Rubric:\n${rubric}\n\nText:\n${text}` },
        ],
        { temperature: 0 },
      );
      state.judgeTokens += r.usage.totalTokens;
      const fail = (reason: string): AgentJudgeResult => ({
        pass: false,
        reason,
      });
      const match = /\{[\s\S]*\}/.exec(r.text);
      if (!match) return fail('judge reply was not JSON');
      try {
        const grade = JSON.parse(match[0]) as {
          pass?: unknown;
          reason?: unknown;
        };
        if (typeof grade.pass !== 'boolean')
          return fail('judge reply has no boolean "pass"');
        return {
          pass: grade.pass,
          reason: typeof grade.reason === 'string' ? grade.reason : '',
        };
      } catch {
        return fail('judge reply was not valid JSON');
      }
    },
  };
}
