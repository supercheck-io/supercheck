/**
 * Runs ended by a worker restart: never a user cancellation, never re-run once the container
 * started, and delayed (not consumed) when it never started.
 */
import type { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { WORKER_INTERRUPTED_ERROR } from '../../common/security/container-executor.service';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';
import { getBillableMs } from '../../common/billable-ms';
import { ExecutionService } from './execution.service';
import { ExecutionCapacityError } from './execution-admission.service';

function createService() {
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
    { uploadReport: jest.fn() } as never,
    {} as never,
    { isCancelled: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
    {
      resolveProjectVariables: jest
        .fn()
        .mockResolvedValue({ variables: {}, secrets: {}, files: {} }),
    } as never,
    {} as never,
  );
  return { service, dbService };
}

const singleTask = {
  testId: 'test-1',
  code: 'test("a", async () => {});',
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'project-1',
};
const jobTask = {
  jobId: 'job-1',
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  testScripts: [{ id: 'test-1', script: 'test("a", async () => {});' }],
};

describe.each([
  ['single test', 'runSingleTestReserved', singleTask],
  ['job', 'runJobReserved', jobTask],
] as const)('ExecutionService interrupted %s', (_label, method, task) => {
  let service: ExecutionService;
  let dbService: ReturnType<typeof createService>['dbService'];

  beforeEach(() => {
    ({ service, dbService } = createService());
  });
  afterEach(() => service.onModuleDestroy());

  const run = () =>
    (
      service as unknown as Record<
        string,
        (task: unknown) => Promise<Record<string, unknown>>
      >
    )[method](task);

  it('delays the run without recording anything when the pod never started', async () => {
    jest
      .spyOn(service, '_executePlaywrightNativeRunner' as never)
      .mockResolvedValue({
        success: false,
        interrupted: true,
        error: WORKER_INTERRUPTED_ERROR,
        stdout: '',
        stderr: '',
        billableMs: 0,
      } as never);

    await expect(run()).rejects.toBeInstanceOf(ExecutionCapacityError);

    expect(dbService.storeReportMetadata).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(dbService.storeReportMetadata).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('ends a started run as an interrupted failure, not a cancellation', async () => {
    jest
      .spyOn(service, '_executePlaywrightNativeRunner' as never)
      .mockResolvedValue({
        success: false,
        interrupted: true,
        error: WORKER_INTERRUPTED_ERROR,
        stdout: '',
        stderr: '',
        billableMs: 42_000,
      } as never);

    const outcome = await run().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(dbService.storeReportMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    if ('error' in outcome) {
      // A single test throws so the processor records it; BullMQ must not re-run it.
      expect(outcome.error).toBeInstanceOf(UnrecoverableError);
      expect((outcome.error as Error).message).toBe(WORKER_INTERRUPTED_ERROR);
      expect(getBillableMs(outcome.error)).toBe(42_000);
    } else {
      expect(outcome.value).toMatchObject({
        success: false,
        interrupted: true,
        error: WORKER_INTERRUPTED_ERROR,
        billableMs: 42_000,
      });
      expect(outcome.value.error).not.toBe(RUN_CANCELLATION_MARKER);
    }
  });

  it('still records an explicit cancellation as a cancellation', async () => {
    jest
      .spyOn(service, '_executePlaywrightNativeRunner' as never)
      .mockResolvedValue({
        success: false,
        cancelled: true,
        error: 'Execution cancelled (exit code 137)',
        stdout: '',
        stderr: '',
        billableMs: 5_000,
      } as never);

    const outcome = await run().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    expect(dbService.storeReportMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
    if ('error' in outcome) {
      // A user cancellation after the container ran is not wrapped: the processor handles it.
      expect(outcome.error).not.toBeInstanceOf(UnrecoverableError);
    } else {
      expect(outcome.value.error).toBe(RUN_CANCELLATION_MARKER);
    }
  });
});

describe('ExecutionService post-container failures of a single test', () => {
  it.each([
    ['plain failure', 'result could not be saved'],
    // A message that merely mentions cancellation must not bypass the no-rerun rule.
    ['message mentioning cancelled', 'upload cancelled by proxy'],
  ])(
    'throws UnrecoverableError after the container ran: %s',
    async (_n, message) => {
      const { service, dbService } = createService();
      jest
        .spyOn(service, '_executePlaywrightNativeRunner' as never)
        .mockResolvedValue({
          success: true,
          stdout: '',
          stderr: '',
          billableMs: 9_000,
        } as never);
      jest
        .spyOn(service, 'evaluatePlaywrightReport' as never)
        .mockRejectedValue(new Error(message) as never);

      const error = await service['runSingleTestReserved'](singleTask).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect((error as Error).message).toBe(message);
      expect(getBillableMs(error)).toBe(9_000);
      expect(dbService.storeReportMetadata).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
      service.onModuleDestroy();
    },
  );

  it('keeps a plain retryable error when no container started', async () => {
    const { service } = createService();
    jest
      .spyOn(service, '_executePlaywrightNativeRunner' as never)
      .mockResolvedValue({
        success: false,
        error: 'Kubernetes unavailable',
        stdout: '',
        stderr: '',
        billableMs: 0,
      } as never);
    jest
      .spyOn(service, 'evaluatePlaywrightReport' as never)
      .mockRejectedValue(new Error('report missing') as never);

    const error = await service['runSingleTestReserved'](singleTask).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    service.onModuleDestroy();
  });
});

describe('ExecutionService.executePlaywrightDirectly interrupted result', () => {
  it('keeps the interrupted flag and message, whatever the secret redaction does to the text', async () => {
    const { service } = createService();
    Object.assign(service, {
      containerExecutorService: {
        resolveWorkerDir: async () => '/worker',
        resolveBrowsersPath: async () => '/browsers',
      },
    });
    jest.spyOn(service, 'executeCommandSafely' as never).mockResolvedValue({
      success: false,
      interrupted: true,
      error: WORKER_INTERRUPTED_ERROR,
      stdout: '',
      stderr: 'some unrelated stderr',
    } as never);

    const result = await service['executePlaywrightDirectly'](
      { scriptContent: 'test', fileName: 'test.spec.ts' },
      '/tmp/reports',
      false,
    );

    expect(result.interrupted).toBe(true);
    expect(result.error).toBe(WORKER_INTERRUPTED_ERROR);
    service.onModuleDestroy();
  });
});
