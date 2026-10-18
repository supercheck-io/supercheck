jest.mock('execa', () => ({
  execa: jest.fn(),
}));

import {
  getFailedHttpRequestCount,
  K6ExecutionProcessor,
} from './k6-execution.processor';
import { Job } from 'bullmq';
import { clearLocationCapabilityCache } from '../../common/location/location-capability';
import { K6ExecutionTask } from '../services/k6-execution.service';
import type { ExecutionUsageTransaction } from '../../execution/services/execution-usage-receipts';

describe('k6 HTTP failure metrics', () => {
  it('uses http_req_failed passes instead of check failures', () => {
    expect(
      getFailedHttpRequestCount({
        http_reqs: { count: 20 },
        http_req_failed: { passes: 3, fails: 17, rate: 0.15 },
        checks: { fails: 9 },
      }),
    ).toBe(3);
  });

  it('falls back to the failure rate when counts are absent', () => {
    expect(
      getFailedHttpRequestCount({
        http_reqs: { count: 20 },
        http_req_failed: { rate: 0.1 },
      }),
    ).toBe(2);
  });
});

describe('k6 durable completion', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'persists terminal results in the receipt transaction (existing result: %s, retry: %s)',
    async (existing, retry) => {
      const result = {
        success: true,
        durationMs: 61000,
        thresholdsPassed: true,
        summary: { metrics: { vus_max: { max: 10 } } },
      };
      const transactionWhere = jest.fn().mockResolvedValue(undefined);
      const transactionSet = jest
        .fn()
        .mockReturnValue({ where: transactionWhere });
      const values = jest.fn().mockResolvedValue(undefined);
      const tx = {
        query: {
          k6PerformanceRuns: {
            findFirst: jest
              .fn()
              .mockResolvedValue(existing ? { id: 'existing' } : undefined),
          },
        },
        insert: jest.fn().mockReturnValue({ values }),
        update: jest.fn().mockReturnValue({ set: transactionSet }),
      };
      const outsideWhere = jest.fn().mockResolvedValue(undefined);
      const outsideSet = jest.fn().mockReturnValue({ where: outsideWhere });
      const db = {
        update: jest.fn().mockReturnValue({ set: outsideSet }),
        insert: jest.fn(),
        // Location capability lookup (k6 backstop)
        execute: jest
          .fn()
          .mockResolvedValue([{ supports_browser: true, supports_k6: true }]),
      };
      const usage = {
        shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
        trackK6Execution: jest.fn().mockResolvedValue({ blocked: false }),
        completeRunWithUsage: jest.fn(
          async (
            _input: unknown,
            persist: (transaction: ExecutionUsageTransaction) => Promise<void>,
          ) => {
            await persist(tx as unknown as ExecutionUsageTransaction);
          },
        ),
      };
      type Dependencies = ConstructorParameters<typeof K6ExecutionProcessor>;
      const execute = jest.fn().mockResolvedValue(result);
      const processor = new K6ExecutionProcessor(
        {
          runK6Test: execute,
          hasActiveExecution: jest.fn().mockResolvedValue(false),
        } as unknown as Dependencies[0],
        { db } as unknown as Dependencies[1],
        { get: () => 'eu' } as unknown as Dependencies[2],
        {} as Dependencies[3],
        usage as unknown as Dependencies[4],
        {} as Dependencies[5],
        {
          isCancelled: jest.fn().mockResolvedValue(false),
        } as unknown as Dependencies[6],
      );
      const job = {
        id: 'queue-id',
        data: {
          runId: 'run-id',
          testId: 'test-id',
          organizationId: 'org-id',
          projectId: 'project-id',
          script: '',
          tests: [],
        },
      } as unknown as Job<K6ExecutionTask>;
      if (retry) {
        job.opts = { attempts: 2 };
        job.attemptsMade = 0;
        execute.mockRejectedValueOnce(new Error('temporary failure'));
        await expect(processor.process(job)).rejects.toThrow(
          'temporary failure',
        );
        expect(usage.completeRunWithUsage).toHaveBeenCalledWith(
          expect.objectContaining({ runId: 'run-id:attempt:0' }),
          expect.any(Function),
        );
        expect(outsideSet).toHaveBeenCalledTimes(1);
        expect(outsideSet).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'running' }),
        );
        job.attemptsMade = 1;
      }
      await expect(processor.process(job)).resolves.toMatchObject({
        success: true,
      });
      expect(usage.completeRunWithUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-id',
          organizationId: 'org-id',
          eventType: 'k6_execution',
          durationMs: 61000,
          virtualUsers: 10,
        }),
        expect.any(Function),
      );
      expect(tx.insert).toHaveBeenCalledTimes(existing ? 0 : 1);
      expect(transactionSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'passed', durationMs: 61000 }),
      );
      expect(db.insert).not.toHaveBeenCalled();
      expect(outsideSet).toHaveBeenCalledTimes(retry ? 2 : 1);
      expect(outsideSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' }),
      );
    },
  );
});

describe('k6 location capability backstop', () => {
  type Dependencies = ConstructorParameters<typeof K6ExecutionProcessor>;

  function build(execute: jest.Mock) {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const db = { update: jest.fn().mockReturnValue({ set }), execute };
    const runK6Test = jest.fn();
    const processor = new K6ExecutionProcessor(
      {
        runK6Test,
        hasActiveExecution: jest.fn().mockResolvedValue(false),
      } as unknown as Dependencies[0],
      { db } as unknown as Dependencies[1],
      { get: () => 'us-east' } as unknown as Dependencies[2],
      {} as Dependencies[3],
      {
        shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
      } as unknown as Dependencies[4],
      {} as Dependencies[5],
      {
        isCancelled: jest.fn().mockResolvedValue(false),
      } as unknown as Dependencies[6],
    );
    return { processor, set, runK6Test };
  }

  const job = (location: string) =>
    ({
      id: 'queue-id',
      data: {
        runId: 'run-id',
        testId: 'test-id',
        organizationId: 'org-id',
        projectId: 'project-id',
        script: '',
        tests: [],
        location,
      },
    }) as unknown as Job<K6ExecutionTask>;

  beforeEach(() => clearLocationCapabilityCache());

  it('fails the run (not left queued) when the location lost k6 capability', async () => {
    const { processor, set, runK6Test } = build(
      jest
        .fn()
        .mockResolvedValue([{ supports_browser: false, supports_k6: false }]),
    );
    await expect(processor.handleProcess(job('us-east'))).rejects.toThrow(
      /does not support k6/,
    );
    expect(runK6Test).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('does not check capability for global or wildcard locations', async () => {
    const execute = jest.fn();
    const { processor, runK6Test } = build(execute);
    runK6Test.mockRejectedValue(new Error('stop after backstop'));
    await expect(processor.handleProcess(job('global'))).rejects.toThrow(
      'stop after backstop',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
