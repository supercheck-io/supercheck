/**
 * Agent tests in the execution service: spec file names (C7), and the agent-summary attachment
 * parsed from results.json into runs.metadata.agent with caps; a bad attachment never changes the run (C9).
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { testIdFromSpecFile } from './agent-summary';
import { ExecutionService } from './execution.service';

const POD_DIR = '/tmp/playwright-reports';

function createService(secrets: Record<string, string> = {}) {
  const dbService = {
    storeReportMetadata: jest.fn().mockResolvedValue(undefined),
    mergeRunMetadata: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ExecutionService(
    { get: () => undefined } as unknown as ConfigService,
    {
      getBaseUrlForEntity: () => 'https://s3/run',
      prepareFileVariables: jest
        .fn()
        .mockResolvedValue({ additionalFiles: {}, filePaths: {} }),
    } as never,
    dbService as never,
    {} as never,
    {
      uploadReport: jest
        .fn()
        .mockResolvedValue({ success: true, reportUrl: 'https://s3/r' }),
    } as never,
    {} as never,
    { isCancelled: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
    {
      resolveProjectVariables: jest
        .fn()
        .mockResolvedValue({ variables: {}, secrets, files: {} }),
    } as never,
    {} as never,
  );
  return { service, dbService };
}

const summary = (over: Record<string, unknown> = {}) => ({
  title: 'bot answers',
  attempts: 10,
  passed: 8,
  totalTokens: 1200,
  judgeTokens: 50,
  cost: 0.01,
  toolNames: ['lookup'],
  durationMs: 9000,
  slowestMs: 2100,
  failures: [{ attempt: 3, message: 'expected 30 days' }],
  transcript: [{ attempt: 1, prompt: 'p', reply: 'r' }],
  ...over,
});

/** A results.json as Playwright writes it: the attachment path is the pod path. */
function report(files: { file: string; attachmentPath?: string }[]) {
  return {
    suites: files.map(({ file, attachmentPath }) => ({
      file,
      specs: [
        {
          tests: [
            {
              results: [
                {
                  status: 'passed',
                  attachments: attachmentPath
                    ? [
                        {
                          name: 'agent-summary',
                          contentType: 'application/json',
                          path: attachmentPath,
                        },
                      ]
                    : [],
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

describe('ExecutionService agent specs', () => {
  describe('file names (C7)', () => {
    const run = async (task: Record<string, unknown>) => {
      const { service } = createService();
      const runner = jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockResolvedValue({
          success: true,
          stdout: '',
          stderr: '',
        } as never);
      jest
        .spyOn(service, 'evaluatePlaywrightReport' as never)
        .mockResolvedValue({ hasFailures: false, foundReport: true } as never);
      await service['runSingleTestReserved']({
        testId: 'test-1',
        code: 'test("a", async () => {});',
        runId: 'run-1',
        ...task,
      });
      service.onModuleDestroy();
      return (runner.mock.calls[0] as unknown as [{ fileName: string }])[0]
        .fileName;
    };

    it('names a single agent test <id>.agent.spec.ts', async () => {
      expect(await run({ testType: 'agent' })).toBe('test-1.agent.spec.ts');
    });

    it.each([undefined, 'browser', 'api'])(
      'keeps <id>.spec.ts when testType is %s',
      async (testType) => {
        expect(await run({ testType })).toBe('test-1.spec.ts');
      },
    );

    it('names job files NNN-<id>.agent.spec.ts only for agent scripts, and reads both back', async () => {
      const { service } = createService();
      const runner = jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockResolvedValue({
          success: true,
          stdout: '',
          stderr: '',
        } as never);
      jest
        .spyOn(service, 'evaluatePlaywrightReport' as never)
        .mockResolvedValue({ hasFailures: false, foundReport: true } as never);
      jest
        .spyOn(service, 'readJobTestStatuses' as never)
        .mockResolvedValue({} as never);
      await service['runJobReserved']({
        jobId: 'job-1',
        runId: 'run-1',
        organizationId: 'org',
        projectId: 'proj',
        testScripts: [
          { id: 'a', script: 'test("a", async () => {});' },
          { id: 'b', script: 'test("b", async () => {});', type: 'agent' },
        ],
      } as never).catch(() => undefined);
      service.onModuleDestroy();
      const call = runner.mock.calls[0] as unknown as [
        { fileName: string },
        string,
        boolean,
        Record<string, string>,
      ];
      expect([call[0].fileName, ...Object.keys(call[3])].join()).toContain(
        '001-a.spec.ts',
      );
      expect([call[0].fileName, ...Object.keys(call[3])].join()).toContain(
        '002-b.agent.spec.ts',
      );

      const real = createService().service;
      const ok = { tests: [{ results: [{ status: 'passed' }] }] };
      const statuses = await real['readJobTestStatuses'](
        '/nowhere',
        ['a', 'b'],
        Promise.resolve({
          suites: [
            { file: '001-a.spec.ts', specs: [ok] },
            { file: '/tmp/002-b.agent.spec.ts', specs: [ok] },
          ],
        }),
      );
      expect(statuses).toEqual({ a: 'passed', b: 'passed' });
      real.onModuleDestroy();
    });
  });

  describe('summary parsing (C9)', () => {
    let dir: string;
    let service: ExecutionService;
    let dbService: ReturnType<typeof createService>['dbService'];
    beforeEach(() => {
      ({ service, dbService } = createService());
      dir = mkdtempSync(path.join(tmpdir(), 'agent-summary-'));
      mkdirSync(path.join(dir, 'a-chromium', 'attachments'), {
        recursive: true,
      });
    });
    afterEach(() => {
      service.onModuleDestroy();
      rmSync(dir, { recursive: true, force: true });
    });

    const put = (
      name: string,
      content: string,
      sub = 'a-chromium/attachments',
    ) => {
      writeFileSync(path.join(dir, sub, name), content);
      return `${POD_DIR}/${sub}/${name}`;
    };
    const read = (
      rep: unknown,
      runId: string | null = 'run-1',
      secrets: Record<string, string> = {},
    ) =>
      service['readAgentTests'](
        dir,
        runId,
        secrets,
        Promise.resolve(rep) as never,
      );

    it('stores the numbers without the transcript and returns them', async () => {
      const p = put('s.json', JSON.stringify(summary()));
      const tests = await read(
        report([{ file: 'abc.agent.spec.ts', attachmentPath: p }]),
      );
      const expected = {
        testId: 'abc',
        title: 'bot answers',
        attempts: 10,
        passed: 8,
        passRate: 0.8,
        totalTokens: 1200,
        judgeTokens: 50,
        cost: 0.01,
        toolNames: ['lookup'],
        durationMs: 9000,
        slowestMs: 2100,
        failures: [{ attempt: 3, message: 'expected 30 days' }],
      };
      expect(tests).toEqual([expected]);
      expect(dbService.mergeRunMetadata).toHaveBeenCalledWith('run-1', {
        agent: { tests: [expected] },
      });
    });

    it('reads job files (NNN- prefix) and returns without a run id when there is none', async () => {
      const p = put('s.json', JSON.stringify(summary({ cost: undefined })));
      const tests = await read(
        report([{ file: '002-abc.agent.spec.ts', attachmentPath: p }]),
        null,
      );
      expect(tests?.[0]).toMatchObject({ testId: 'abc' });
      expect(tests?.[0]).not.toHaveProperty('cost');
      expect(dbService.mergeRunMetadata).not.toHaveBeenCalled();
    });

    it('clips tool names, failures and messages, and coerces bad numbers', async () => {
      const p = put(
        's.json',
        JSON.stringify(
          summary({
            title: 't'.repeat(500),
            attempts: 'many',
            passed: 99,
            totalTokens: null,
            toolNames: Array.from(
              { length: 80 },
              (_, i) => `tool${i}${'x'.repeat(200)}`,
            ),
            failures: Array.from({ length: 9 }, (_, i) => ({
              attempt: i,
              message: 'm'.repeat(900),
            })),
          }),
        ),
      );
      const [t] = (await read(
        report([{ file: 'x.agent.spec.ts', attachmentPath: p }]),
      ))!;
      expect(t.title).toHaveLength(200);
      expect(t.attempts).toBe(0);
      expect(t.passed).toBe(0);
      expect(t.passRate).toBe(0);
      expect(t.totalTokens).toBe(0);
      expect(t.toolNames).toHaveLength(50);
      expect(t.toolNames[0]).toHaveLength(100);
      expect(t.failures).toHaveLength(5);
      expect(t.failures[0].message).toHaveLength(200);
    });

    it('redacts run secrets from title, tool names and failure messages before clipping', async () => {
      const secret = 'sup3r-secret-value';
      const p = put(
        's.json',
        JSON.stringify(
          summary({
            title: `t ${secret}`,
            toolNames: [`call_${secret}`],
            // the secret straddles the 200 char clip
            failures: [{ attempt: 1, message: `${'x'.repeat(190)}${secret}` }],
          }),
        ),
      );
      await read(
        report([{ file: 'abc.agent.spec.ts', attachmentPath: p }]),
        'run-1',
        { TOKEN: secret },
      );
      const stored = JSON.stringify(dbService.mergeRunMetadata.mock.calls);
      expect(stored).not.toContain('sup3r');
      expect(stored).toContain('[SECRET]');
    });

    it('does not take a UUID with a numeric first segment for a job prefix', () => {
      expect(
        testIdFromSpecFile(
          '01934567-1234-7abc-8def-0123456789ab.agent.spec.ts',
        ),
      ).toBe('01934567-1234-7abc-8def-0123456789ab');
      expect(testIdFromSpecFile('002-abc.agent.spec.ts')).toBe('abc');
    });

    it('skips a symlinked summary', async () => {
      const real = path.join(dir, 'real.json');
      writeFileSync(real, JSON.stringify(summary()));
      symlinkSync(real, path.join(dir, 'a-chromium/attachments/link.json'));
      expect(
        await read(
          report([
            {
              file: 'a.agent.spec.ts',
              attachmentPath: `${POD_DIR}/a-chromium/attachments/link.json`,
            },
          ]),
        ),
      ).toBeUndefined();
    });

    it('keeps at most 20 tests and 8 KiB in the run metadata', async () => {
      const big = summary({
        toolNames: Array.from(
          { length: 50 },
          (_, i) => `${'t'.repeat(90)}${i}`,
        ),
        failures: Array.from({ length: 5 }, () => ({
          attempt: 1,
          message: 'm'.repeat(200),
        })),
      });
      const p = put('s.json', JSON.stringify(big));
      const files = Array.from({ length: 25 }, (_, i) => ({
        file: `t${i}.agent.spec.ts`,
        attachmentPath: p,
      }));
      const tests = (await read(report(files)))!;
      const stored = (
        dbService.mergeRunMetadata.mock.calls[0][1] as {
          agent: { tests: unknown[] };
        }
      ).agent.tests;
      expect(tests.length).toBeLessThanOrEqual(20);
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.length).toBeLessThan(20);
      expect(
        Buffer.byteLength(JSON.stringify({ tests: stored })),
      ).toBeLessThanOrEqual(8192);
    });

    it('leaves the run alone for a missing, oversized, malformed or foreign attachment', async () => {
      const bad = [
        `${POD_DIR}/a-chromium/attachments/missing.json`,
        put(
          'big.json',
          JSON.stringify(summary({ pad: 'x'.repeat(600 * 1024) })),
        ),
        put('bad.json', '{not json'),
        '/etc/passwd',
        `${POD_DIR}/../../etc/passwd`,
        '/tmp/other-dir/s.json',
      ];
      const tests = await read(
        report(
          bad.map((attachmentPath, i) => ({
            file: `t${i}.agent.spec.ts`,
            attachmentPath,
          })),
        ),
      );
      expect(tests).toBeUndefined();
      // cleared, so a re-driven run keeps no stale numbers
      expect(dbService.mergeRunMetadata).toHaveBeenCalledWith('run-1', {
        agent: null,
      });
    });

    it('ignores tests without the attachment and non-agent spec files', async () => {
      const p = put('s.json', JSON.stringify(summary()));
      expect(
        await read(
          report([
            { file: 'a.agent.spec.ts' },
            { file: 'plain.spec.ts', attachmentPath: p },
          ]),
        ),
      ).toBeUndefined();
    });

    it('does not throw when results.json cannot be read, or the db write fails', async () => {
      expect(
        await service['readAgentTests'](
          dir,
          'run-1',
          {},
          Promise.reject(new Error('gone')) as never,
        ),
      ).toBeUndefined();
      dbService.mergeRunMetadata.mockRejectedValueOnce(new Error('db down'));
      const p = put('s.json', JSON.stringify(summary()));
      // the numbers still reach the caller (monitor result) when the run write fails
      expect(
        await read(report([{ file: 'a.agent.spec.ts', attachmentPath: p }])),
      ).toHaveLength(1);
    });
  });

  describe('single run flow', () => {
    it('puts the parsed summary on the result and the run, and fails nothing when it is missing', async () => {
      const { service, dbService } = createService();
      const extracted: string[] = [];
      jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockImplementation((async (_script: unknown, dir: string) => {
          extracted.push(dir);
          mkdirSync(path.join(dir, 'attachments'), { recursive: true });
          writeFileSync(
            path.join(dir, 'attachments', 's.json'),
            JSON.stringify(summary()),
          );
          writeFileSync(
            path.join(dir, 'results.json'),
            JSON.stringify(
              report([
                {
                  file: 'test-1.agent.spec.ts',
                  attachmentPath: `${POD_DIR}/attachments/s.json`,
                },
              ]),
            ),
          );
          return { success: true, stdout: '', stderr: '' };
        }) as never);
      const result = await service['runSingleTestReserved']({
        testId: 'test-1',
        code: 'test("a", async () => {});',
        runId: 'run-1',
        testType: 'agent',
      });
      expect(result.success).toBe(true);
      expect(result.agent?.[0]).toMatchObject({
        testId: 'test-1',
        passRate: 0.8,
      });
      expect(dbService.mergeRunMetadata).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ agent: expect.anything() }),
      );

      // no summary: the run result is unchanged
      dbService.mergeRunMetadata.mockClear();
      jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockImplementation((async (_s: unknown, dir: string) => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            path.join(dir, 'results.json'),
            JSON.stringify(report([{ file: 'test-1.agent.spec.ts' }])),
          );
          return { success: true, stdout: '', stderr: '' };
        }) as never);
      const plain = await service['runSingleTestReserved']({
        testId: 'test-1',
        code: 'test("a", async () => {});',
        runId: 'run-2',
        testType: 'agent',
      });
      expect(plain.success).toBe(true);
      expect(plain.agent).toBeUndefined();
      expect(dbService.mergeRunMetadata).toHaveBeenCalledWith('run-2', {
        agent: null,
      });
      service.onModuleDestroy();
    });

    const secretRun = (
      secret: string,
      file: string,
      call: (service: ExecutionService) => Promise<unknown>,
    ) => {
      const { service, dbService } = createService({ PW: secret });
      jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockImplementation((async (_s: unknown, dir: string) => {
          mkdirSync(path.join(dir, 'attachments'), { recursive: true });
          writeFileSync(
            path.join(dir, 'attachments', 's.json'),
            JSON.stringify(
              summary({
                failures: [{ attempt: 1, message: `leak ${secret}` }],
              }),
            ),
          );
          writeFileSync(
            path.join(dir, 'results.json'),
            JSON.stringify(
              report([
                {
                  file,
                  attachmentPath: `${POD_DIR}/attachments/s.json`,
                },
              ]),
            ),
          );
          return { success: true, stdout: '', stderr: '' };
        }) as never);
      jest
        .spyOn(service, 'evaluatePlaywrightReport' as never)
        .mockResolvedValue({ hasFailures: false, foundReport: true } as never);
      jest
        .spyOn(service, 'readJobTestStatuses' as never)
        .mockResolvedValue({} as never);
      return call(service)
        .catch(() => undefined)
        .then(() => {
          service.onModuleDestroy();
          return JSON.stringify(dbService.mergeRunMetadata.mock.calls);
        });
    };

    it('never sends a run secret to the run metadata (single)', async () => {
      const stored = await secretRun(
        'hunter2-secret',
        'test-1.agent.spec.ts',
        (s) =>
          s['runSingleTestReserved']({
            testId: 'test-1',
            code: 'test("a", async () => {});',
            runId: 'run-1',
            testType: 'agent',
            secrets: { PW: 'hunter2-secret' },
          }),
      );
      expect(stored).toContain('leak [SECRET]');
      expect(stored).not.toContain('hunter2');
    });

    it('never sends a run secret to the run metadata (job)', async () => {
      const stored = await secretRun(
        'hunter2-secret',
        '001-a.agent.spec.ts',
        (s) =>
          s['runJobReserved']({
            jobId: 'job-1',
            runId: 'run-1',
            organizationId: 'org',
            projectId: 'proj',
            testScripts: [
              { id: 'a', script: 'test("a", async () => {});', type: 'agent' },
            ],
            secrets: { PW: 'hunter2-secret' },
          } as never),
      );
      expect(stored).toContain('leak [SECRET]');
      expect(stored).not.toContain('hunter2');
    });
  });
});
