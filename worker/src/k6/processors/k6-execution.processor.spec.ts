jest.mock('../../execution/services/run-callback', () => ({
  ...jest.requireActual('../../execution/services/run-callback'),
  withRunCallback: jest.fn((_db, _runId, callback) => callback()),
}));
jest.mock('execa', () => ({
  execa: jest.fn(),
}));

import {
  getFailedHttpRequestCount,
  K6ExecutionProcessor,
} from './k6-execution.processor';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { attachBillableMs } from '../../common/billable-ms';
import { clearLocationCapabilityCache } from '../../common/location/location-capability';
import { CAPACITY_DEFERRAL_LIMIT } from '../../common/capacity-deferral';
import { ExecutionCapacityError } from '../../execution/services/execution-admission.service';
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
    [false, false, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])(
    'persists terminal results in the receipt transaction (existing result: %s, retry: %s, test exists: %s)',
    async (existing, retry, testExists) => {
      const result = {
        success: true,
        durationMs: 61000,
        billableMs: 61000,
        billingVirtualUsers: 10,
        thresholdsPassed: true,
        summary: { metrics: { vus_max: { max: 10 } } },
      };
      const transactionWhere = jest.fn().mockResolvedValue(undefined);
      const transactionSet = jest
        .fn()
        .mockReturnValue({ where: transactionWhere });
      const values = jest.fn().mockResolvedValue(undefined);
      const forKeyShare = jest
        .fn()
        .mockResolvedValue(testExists ? [{ id: 'test-id' }] : []);
      const tx = {
        query: {
          k6PerformanceRuns: {
            findFirst: jest
              .fn()
              .mockResolvedValue(existing ? { id: 'existing' } : undefined),
          },
        },
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ for: forKeyShare }),
          }),
        }),
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
      const getTerminalRun = jest.fn().mockResolvedValue(undefined);
      const processor = new K6ExecutionProcessor(
        {
          runK6Test: execute,
          hasActiveExecution: jest.fn().mockResolvedValue(false),
        } as unknown as Dependencies[0],
        {
          db,
          getTerminalRun,
          claimRunExecution: jest.fn().mockResolvedValue(true),
          finalizeCancelledRun: jest.fn().mockResolvedValue(false),
        } as unknown as Dependencies[1],
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
        // The container had run for 20s before the transient failure.
        execute.mockRejectedValueOnce(
          attachBillableMs(new Error('temporary failure'), 20_000),
        );
        await expect(processor.process(job)).rejects.toThrow(
          'temporary failure',
        );
        expect(usage.completeRunWithUsage).toHaveBeenCalledWith(
          expect.objectContaining({
            runId: 'run-id:attempt:0',
            durationMs: 20_000,
          }),
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
      if (!existing) {
        expect(forKeyShare).toHaveBeenCalledWith('key share');
        // A test deleted mid-run must not fail the result: the link is dropped.
        expect(values).toHaveBeenCalledWith(
          expect.objectContaining({ testId: testExists ? 'test-id' : null }),
        );
      }
      expect(transactionSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'passed', durationMs: 61000 }),
      );
      expect(db.insert).not.toHaveBeenCalled();
      expect(outsideSet).toHaveBeenCalledTimes(retry ? 2 : 1);
      if (!existing && !retry) {
        getTerminalRun.mockResolvedValue({
          status: 'passed',
          errorDetails: null,
        });
        await expect(processor.process(job)).resolves.toMatchObject({
          success: true,
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(usage.completeRunWithUsage).toHaveBeenCalledTimes(1);
      }

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
      {
        db,
        getTerminalRun: jest.fn().mockResolvedValue(undefined),
        claimRunExecution: jest.fn().mockResolvedValue(true),
        finalizeCancelledRun: jest.fn().mockResolvedValue(false),
      } as unknown as Dependencies[1],
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

describe('k6 container-start metering', () => {
  type Dependencies = ConstructorParameters<typeof K6ExecutionProcessor>;

  function build(runK6Test: jest.Mock) {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const db = {
      update: jest.fn().mockReturnValue({ set }),
      insert: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ supports_browser: true, supports_k6: true }]),
    };
    const usage = {
      shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
      trackK6Execution: jest.fn().mockResolvedValue({ blocked: false }),
      completeRunWithUsage: jest.fn().mockResolvedValue(undefined),
    };
    const dbService = {
      db,
      getTerminalRun: jest.fn().mockResolvedValue(undefined),
      claimRunExecution: jest.fn().mockResolvedValue(true),
      finalizeCancelledRun: jest.fn().mockResolvedValue(false),
      getRunStatusesForJob: jest.fn(),
      updateJobStatus: jest.fn(),
      updateRunStatus: jest.fn().mockResolvedValue(undefined),
      failRunUnlessCancelled: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new K6ExecutionProcessor(
      {
        runK6Test,
        hasActiveExecution: jest.fn().mockResolvedValue(false),
      } as unknown as Dependencies[0],
      dbService as unknown as Dependencies[1],
      { get: () => 'eu' } as unknown as Dependencies[2],
      {} as Dependencies[3],
      usage as unknown as Dependencies[4],
      {} as Dependencies[5],
      {
        isCancelled: jest.fn().mockResolvedValue(false),
      } as unknown as Dependencies[6],
    );
    return { processor, usage, set, dbService };
  }

  const job = () =>
    ({
      id: 'queue-id',
      opts: { attempts: 1 },
      attemptsMade: 0,
      data: {
        runId: 'run-id',
        testId: 'test-id',
        organizationId: 'org-id',
        projectId: 'project-id',
        script: '',
        tests: [],
      },
    }) as unknown as Job<K6ExecutionTask>;

  it('marks the run running without clobbering an admission-time startedAt', async () => {
    const runK6Test = jest.fn().mockRejectedValue(new Error('stop after mark'));
    const { processor, set } = build(runK6Test);
    await expect(processor.process(job())).rejects.toThrow();
    const runningMark = set.mock.calls.find(
      ([values]) => values.status === 'running',
    );
    expect(runningMark).toBeDefined();
    // startedAt must be a coalesce() SQL expression, not a fresh Date.
    expect(runningMark![0].startedAt).not.toBeInstanceOf(Date);
  });

  describe('capacity wait give-up', () => {
    const exhaustedJob = () => {
      const base = job();
      Object.assign(base.data, { _capacityDeferrals: CAPACITY_DEFERRAL_LIMIT });
      return base;
    };

    it('fails the run that never got a slot, unless cancelled, in one guarded write', async () => {
      const runK6Test = jest
        .fn()
        .mockRejectedValue(new ExecutionCapacityError('busy'));
      const { processor, dbService } = build(runK6Test);

      await expect(processor.process(exhaustedJob())).rejects.toThrow(
        /capacity stayed occupied/,
      );

      expect(dbService.failRunUnlessCancelled).toHaveBeenCalledWith(
        'run-id',
        expect.stringContaining('capacity stayed occupied'),
      );
      expect(dbService.updateRunStatus).not.toHaveBeenCalled();
    });

    it('still gives up the job when the guarded write errors', async () => {
      const runK6Test = jest
        .fn()
        .mockRejectedValue(new ExecutionCapacityError('busy'));
      const { processor, dbService } = build(runK6Test);
      dbService.failRunUnlessCancelled.mockRejectedValue(new Error('db down'));

      await expect(processor.process(exhaustedJob())).rejects.toThrow(
        /capacity stayed occupied/,
      );
    });
  });

  it('fails the run terminally when Kubernetes stays unreachable past the bounded wait', async () => {
    const runK6Test = jest.fn();
    const { processor, set, usage, dbService } = build(runK6Test);
    (
      processor as unknown as {
        k6ExecutionService: { hasActiveExecution: jest.Mock };
      }
    ).k6ExecutionService.hasActiveExecution = jest
      .fn()
      .mockRejectedValue(
        new Error('Unable to verify Kubernetes execution state'),
      );
    const failure = processor.process(job());
    await expect(failure).rejects.toThrow(
      /Unable to verify Kubernetes execution state/,
    );
    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
    expect(dbService.failRunUnlessCancelled).toHaveBeenCalledWith(
      'run-id',
      expect.stringContaining('Unable to verify Kubernetes execution state'),
    );
    expect(set).not.toHaveBeenCalled();
    expect(runK6Test).not.toHaveBeenCalled();
    expect(usage.completeRunWithUsage).not.toHaveBeenCalled();
  });

  it('defers a run that finds the pod busy without consuming an attempt', async () => {
    const runK6Test = jest
      .fn()
      .mockRejectedValue(new ExecutionCapacityError('busy'));
    const { processor, usage } = build(runK6Test);
    const queued = Object.assign(job(), {
      opts: { attempts: 3 },
      token: 'token',
      updateData: jest.fn().mockResolvedValue(undefined),
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    });

    await expect(processor.process(queued)).rejects.toBeInstanceOf(
      DelayedError,
    );

    expect(queued.moveToDelayed).toHaveBeenCalledTimes(1);
    expect(queued.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ _capacityDeferrals: 1 }),
    );
    expect(usage.completeRunWithUsage).not.toHaveBeenCalled();
  });

  it('does not retry (and re-run k6) when a finished run cannot be saved', async () => {
    const runK6Test = jest.fn().mockResolvedValue({
      success: true,
      timedOut: false,
      runId: 'run-id',
      durationMs: 4000,
      billableMs: 4000,
      billingVirtualUsers: 1,
      summary: {},
      thresholdsPassed: true,
      error: null,
    });
    const { processor, usage } = build(runK6Test);
    usage.completeRunWithUsage.mockRejectedValueOnce(new Error('db down'));
    const queued = Object.assign(job(), { opts: { attempts: 3 } });

    const failure = processor.process(queued);

    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(failure).rejects.toThrow(/could not be saved.*db down/);
    expect(runK6Test).toHaveBeenCalledTimes(1);
    // The failure is still recorded for the run, with the container time that ran.
    expect(usage.completeRunWithUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationMs: 4000, runId: 'run-id' }),
      expect.any(Function),
    );
  });

  it('records a restart-interrupted run as an error without alerting anyone', async () => {
    const runK6Test = jest.fn().mockResolvedValue({
      success: false,
      interrupted: true,
      timedOut: false,
      runId: 'run-id',
      durationMs: 4000,
      billableMs: 4000,
      billingVirtualUsers: 1,
      summary: null,
      thresholdsPassed: false,
      error: 'Interrupted by worker restart',
    });
    const { processor } = build(runK6Test);
    const notify = jest.fn().mockResolvedValue(undefined);
    (
      processor as unknown as {
        jobNotificationService: { handleJobNotifications: jest.Mock };
      }
    ).jobNotificationService = { handleJobNotifications: notify };
    const queued = job();
    Object.assign(queued.data, { jobId: 'job-1' });

    const result = await processor.process(queued);

    expect(result).toMatchObject({
      success: false,
      error: 'Interrupted by worker restart',
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ cancelled: true, finalStatus: 'error' }),
    );
  });

  it('never records a post-run save failure as a cancellation, whatever its message says', async () => {
    const runK6Test = jest.fn().mockResolvedValue({
      success: true,
      timedOut: false,
      runId: 'run-id',
      durationMs: 4000,
      billableMs: 4000,
      billingVirtualUsers: 1,
      summary: {},
      thresholdsPassed: true,
      error: null,
    });
    const { processor, usage, set } = build(runK6Test);
    usage.completeRunWithUsage.mockRejectedValueOnce(
      new Error('statement cancelled by timeout'),
    );
    const queued = Object.assign(job(), { opts: { attempts: 3 } });

    await expect(processor.process(queued)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(runK6Test).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        errorDetails: 'Cancellation requested by user',
      }),
    );
  });

  it('locks a job for five minutes so a crashed worker releases its run quickly', () => {
    expect(
      Reflect.getMetadata('bullmq:worker_metadata', K6ExecutionProcessor),
    ).toMatchObject({ lockDuration: 300_000 });
  });

  it('creates no usage receipt when the run fails before any container started', async () => {
    const runK6Test = jest
      .fn()
      .mockRejectedValue(new Error('Max concurrent k6 runs reached: 1'));
    const { processor, usage, set } = build(runK6Test);
    await expect(processor.process(job())).rejects.toThrow();
    expect(usage.completeRunWithUsage).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('leaves the job retryable when the failure cannot be recorded', async () => {
    const runK6Test = jest.fn();
    const { processor, dbService, set, usage } = build(runK6Test);
    (
      processor as unknown as {
        k6ExecutionService: { hasActiveExecution: jest.Mock };
      }
    ).k6ExecutionService.hasActiveExecution = jest
      .fn()
      .mockRejectedValue('Unable to verify Kubernetes execution state');
    dbService.failRunUnlessCancelled.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const failure = processor.process(job());
    await expect(failure).rejects.toThrow(
      /Unable to verify Kubernetes execution state/,
    );
    await expect(failure).rejects.not.toBeInstanceOf(UnrecoverableError);
    expect(runK6Test).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(usage.completeRunWithUsage).not.toHaveBeenCalled();
  });

  it('charges the observed container time when a failure follows the start', async () => {
    const runK6Test = jest
      .fn()
      .mockRejectedValue(attachBillableMs(new Error('upload failed'), 30_000));
    const { processor, usage } = build(runK6Test);
    await expect(processor.process(job())).rejects.toThrow();
    expect(usage.completeRunWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: 30_000,
        eventType: 'k6_execution',
      }),
      expect.any(Function),
    );
  });

  it('does not charge a returned result with no container-start evidence', async () => {
    const runK6Test = jest.fn().mockResolvedValue({
      success: false,
      timedOut: false,
      runId: 'run-id',
      durationMs: 4000,
      billableMs: 0,
      summary: null,
      thresholdsPassed: false,
      error: 'Execution cancelled',
      cancelled: true,
    });
    const { processor, usage } = build(runK6Test);
    await processor.process(job());
    expect(usage.completeRunWithUsage).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 0 }),
      expect.any(Function),
    );
    expect(usage.trackK6Execution).not.toHaveBeenCalled();
  });
});

describe('k6 execution admission', () => {
  it('does not execute or publish terminal state when another callback may still be draining', async () => {
    type Dependencies = ConstructorParameters<typeof K6ExecutionProcessor>;
    const runK6Test = jest.fn();
    const updateRunStatus = jest.fn();
    const claimRunExecution = jest.fn().mockResolvedValue(false);
    const finalizeCancelledRun = jest.fn().mockResolvedValue(true);
    const processor = new K6ExecutionProcessor(
      {
        runK6Test,
        hasActiveExecution: async () => false,
      } as unknown as Dependencies[0],
      {
        claimRunExecution,
        finalizeCancelledRun,
        getTerminalRun: async () => undefined,
        updateRunStatus,
      } as unknown as Dependencies[1],
      { get: () => 'eu' } as unknown as Dependencies[2],
      {} as Dependencies[3],
      {} as Dependencies[4],
      {} as Dependencies[5],
      {} as Dependencies[6],
    );
    const result = await processor.process({
      data: { runId: 'run-id', location: 'eu' },
    } as never);
    expect(result).toMatchObject({
      success: false,
      error: 'Cancellation requested by user',
    });
    expect(claimRunExecution).toHaveBeenCalledWith('run-id');
    expect(finalizeCancelledRun).toHaveBeenCalledWith('run-id');
    expect(runK6Test).not.toHaveBeenCalled();
    expect(updateRunStatus).not.toHaveBeenCalled();
  });
});
