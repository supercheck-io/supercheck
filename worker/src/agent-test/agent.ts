import { AsyncLocalStorage } from 'node:async_hooks';
import { stripVTControlCharacters } from 'node:util';
import {
  chatCompletion,
  createClient,
  secretsOf,
  validateOptions,
} from './clients';
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
      validateOptions(options);
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
      const deadline = Date.now() + REPEAT_BUDGET_MS;
      // A nested repeat runs inside an attempt that is already counted, so only the top level is recorded.
      const topLevel = attemptOf.getStore() === undefined;
      const failures: AgentRepeatResult['failures'] = [];
      let passes = 0;
      // Live: recorded before the first attempt, so a test that aborts mid-repeat still reports partial counts.
      const result: AgentRepeatResult = {
        attempts: n,
        passed: 0,
        failed: 0,
        passRate: 0,
        failures,
      };
      const sync = () => {
        failures.sort((a, b) => a.attempt - b.attempt);
        result.passed = passes;
        result.failed = failures.length;
        result.passRate = passes / n;
      };
      if (topLevel) state.repeats.push(result);
      let next = 0;
      const lane = async () => {
        while (next < n) {
          const attempt = ++next;
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            failures.push({ attempt, message: 'not run: time budget used' });
            sync();
            continue;
          }
          let timer: NodeJS.Timeout | undefined;
          const attemptRun = attemptOf.run(attempt, async () => fn());
          // If the budget wins the race, the attempt keeps running; its late rejection must not escape.
          attemptRun.catch(() => undefined);
          try {
            await Promise.race([
              attemptRun,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('not finished: time budget used')),
                  remaining,
                );
                // The budget only bounds attempts; it must never keep the process alive.
                timer.unref();
              }),
            ]);
            passes++;
          } catch (error) {
            failures.push({ attempt, message: message(error) });
          } finally {
            clearTimeout(timer);
          }
          sync();
        }
      };
      await Promise.all(Array.from({ length: concurrency }, lane));
      sync();
      return result;
    },

    async judge(text, rubric, options) {
      validateOptions({ kind: 'openai', ...options }, 'agent.judge');
      state.secrets.push(...secretsOf(options));
      const r = await chatCompletion(options, [
        {
          role: 'system',
          content:
            'You grade a text against a rubric. Reply with only JSON: {"pass": true|false, "reason": "<one sentence>"}.',
        },
        { role: 'user', content: `Rubric:\n${rubric}\n\nText:\n${text}` },
      ]);
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
