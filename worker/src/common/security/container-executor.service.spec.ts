jest.mock('fs/promises');

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  computeBillableMs,
  ContainerExecutionOptions,
  ContainerExecutorService,
} from './container-executor.service';
import { CancellationService } from '../services/cancellation.service';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';

const defaultOptions: ContainerExecutionOptions = {
  inlineScriptContent: 'console.log("hello")',
  inlineScriptFileName: 'test.spec.ts',
  timeoutMs: 30000,
  memoryLimitMb: 512,
  cpuLimit: 0.5,
};

describe('ContainerExecutorService', () => {
  let service: ContainerExecutorService;
  let mockConfigGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfigGet = jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
      };
      return config[key] ?? defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerExecutorService,
        {
          provide: ConfigService,
          useValue: {
            get: mockConfigGet,
          },
        },
        {
          provide: CancellationService,
          useValue: {
            isCancelled: jest.fn().mockResolvedValue(false),
            clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ContainerExecutorService>(ContainerExecutorService);
    jest
      .spyOn(service as any, 'ensureKubernetesClients')
      .mockResolvedValue(undefined);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('isolation canary admission', () => {
    it('reads only the selected pool and refuses a fresh explicit failure', async () => {
      mockConfigGet.mockImplementation((key: string) =>
        key === 'ISOLATION_CANARY_GATE_ENABLED' ? 'true' : undefined,
      );
      (service as any).executionNodeSelector = { region: 'eu-central' };
      const read = jest.fn().mockResolvedValue({
        data: {
          'eu-central': JSON.stringify({
            status: 'failed',
            completedAt: new Date().toISOString(),
          }),
        },
      });
      (service as any).coreApi = { readNamespacedConfigMap: read };
      await expect(
        (service as any).checkIsolationCanaryAdmission(),
      ).rejects.toThrow('isolation canary failed for pool eu-central');
      expect(read).toHaveBeenCalledWith({
        namespace: 'supercheck-execution',
        name: 'isolation-pool-health',
      });
      read.mockResolvedValue({ data: {} });
      await expect(
        (service as any).checkIsolationCanaryAdmission(),
      ).resolves.toBeUndefined();
      read.mockRejectedValue(new Error('API unavailable'));
      await expect(
        (service as any).checkIsolationCanaryAdmission(),
      ).resolves.toBeUndefined();
    });

    it('does not query health when the rollout flag is disabled', async () => {
      const read = jest.fn();
      (service as any).coreApi = { readNamespacedConfigMap: read };
      await (service as any).checkIsolationCanaryAdmission();
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('backend configuration', () => {
    it('initializes kubernetes clients on startup', async () => {
      const ensureClients = jest.spyOn(
        service as any,
        'ensureKubernetesClients',
      );
      await service.onModuleInit();
      expect(ensureClients).toHaveBeenCalled();
    });

    it('bounds execution pod ephemeral storage and tmp volume size', () => {
      const manifest = (service as any).buildExecutionJob({
        jobName: 'sc-exec-test',
        workspace: '/tmp/supercheck/run-test',
        shellScript: 'node test.js',
        workingDir: '/tmp',
        limits: {
          timeoutMs: 30000,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
        },
        options: {
          ...defaultOptions,
          runId: '018f0000-0000-7000-8000-000000000001',
        },
      });

      const container = manifest.spec.template.spec.containers[0];
      expect(container.resources.requests['ephemeral-storage']).toBe('1Gi');
      expect(container.resources.limits['ephemeral-storage']).toBe('8Gi');
      expect(manifest.spec.template.spec.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'tmp',
            emptyDir: { sizeLimit: '8Gi' },
          }),
        ]),
      );
    });

    it('fails startup when ephemeral storage exceeds the admission ceiling', () => {
      expect(
        () =>
          new ContainerExecutorService(
            {
              get: jest.fn((key: string, defaultValue?: string) => {
                const config: Record<string, string> = {
                  WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
                  EXECUTION_EPHEMERAL_STORAGE_LIMIT: '11Gi',
                  EXECUTION_MAX_EPHEMERAL_STORAGE_LIMIT: '10Gi',
                };
                return config[key] ?? defaultValue;
              }),
            } as any,
            {
              isCancelled: jest.fn().mockResolvedValue(false),
              clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
            } as any,
          ),
      ).toThrow('EXECUTION_EPHEMERAL_STORAGE_LIMIT (11Gi) exceeds');
    });
  });

  describe('input validation', () => {
    it('rejects non-null scriptPath (legacy mode)', async () => {
      const result = await service.executeInContainer(
        '/tmp/test.ts',
        ['node'],
        defaultOptions,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Legacy execution mode not supported');
    });

    it('rejects missing inlineScriptContent', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        inlineScriptFileName: 'test.ts',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing inline script content');
    });

    it('rejects missing inlineScriptFileName', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        inlineScriptContent: 'console.log("hi")',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing script filename');
    });

    it('rejects invalid additional file paths', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        additionalFiles: {
          '../../../etc/passwd': 'bad',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must not escape the execution workspace');
    });

    it('rejects ensureDirectories paths outside the execution workspace', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        ensureDirectories: ['/etc/supercheck'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'must stay within the execution workspace',
      );
    });

    it('rejects extractFromContainer without extractToHost', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        extractFromContainer: '/tmp/report',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid extraction configuration');
    });

    it('rejects extractFromContainer paths outside the execution workspace', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        extractFromContainer: '/etc/passwd',
        extractToHost: '/tmp/output',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('extractFromContainer');
    });
  });

  describe('resource limits', () => {
    it('rejects memory below 128MB', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        memoryLimitMb: 32,
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('memoryLimitMb');
      expect(result.stderr).toContain('below minimum');
    });

    it('rejects CPU above 4', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        cpuLimit: 8,
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('cpuLimit');
      expect(result.stderr).toContain('exceeds maximum');
    });

    it('rejects resources above the shipped execution LimitRange', () => {
      expect(
        service.validateResourceLimits({
          memoryLimitMb: 3435,
          cpuLimit: 1,
          timeoutMs: 30_000,
        }),
      ).toMatchObject({ valid: false });
      expect(
        service.validateResourceLimits({
          memoryLimitMb: 512,
          cpuLimit: 2.1,
          timeoutMs: 30_000,
        }),
      ).toMatchObject({ valid: false });
    });

    it('rejects non-finite resource limits', async () => {
      const result = await service.executeInContainer(null, ['node'], {
        ...defaultOptions,
        memoryLimitMb: Number.NaN,
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('finite number');
    });
  });

  describe('Kubernetes exec socket lifecycle', () => {
    it('resolves immediately when the socket closed before listeners attached', async () => {
      const socket = Object.assign(new EventEmitter(), {
        readyState: 3,
        close: jest.fn(),
      });

      await expect(
        (service as any).waitForExecSocket(socket, 'short exec'),
      ).resolves.toBeUndefined();
    });

    it('waits for a close event from an open socket', async () => {
      const socket = Object.assign(new EventEmitter(), {
        readyState: 1,
        close: jest.fn(),
      });
      const completion = (service as any).waitForExecSocket(
        socket,
        'streaming exec',
      );

      socket.readyState = 3;
      socket.emit('close');

      await expect(completion).resolves.toBeUndefined();
    });

    it('uses the configured artifact socket timeout for tar capture', async () => {
      const configuredService = new ContainerExecutorService(
        {
          get: jest.fn((key: string, defaultValue?: string) => {
            const config: Record<string, string> = {
              WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
              EXECUTION_ARTIFACT_SOCKET_TIMEOUT_MS: '123456',
            };
            return config[key] ?? defaultValue;
          }),
        } as any,
        {
          isCancelled: jest.fn().mockResolvedValue(false),
          clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
        } as any,
      );
      const socket = Object.assign(new EventEmitter(), {
        readyState: 3,
        close: jest.fn(),
      });
      (configuredService as any).execClient = {
        exec: jest.fn().mockResolvedValue(socket),
      };
      const waitForExecSocket = jest.spyOn(
        configuredService as any,
        'waitForExecSocket',
      );

      await expect(
        (configuredService as any).capturePodTarStream(
          'execution-pod',
          '/tmp/supercheck/run-test/report',
        ),
      ).resolves.toEqual(Buffer.alloc(0));
      expect(waitForExecSocket).toHaveBeenCalledWith(
        socket,
        'artifact extraction from pod execution-pod',
        123456,
      );
    });
  });

  describe('hasActiveExecution', () => {
    function failingApi() {
      service['ensureKubernetesClients'] = jest
        .fn()
        .mockResolvedValue(undefined);
      service['batchApi'] = {
        listNamespacedJob: jest
          .fn()
          .mockRejectedValue(new Error('apiserver down')),
      } as unknown as NonNullable<(typeof service)['batchApi']>;
    }

    it('assumes a run is active while Kubernetes cannot be queried', async () => {
      failingApi();
      await expect(service.hasActiveExecution('run-1')).resolves.toBe(true);
      await expect(
        service.hasActiveExecution('run-1', { boundUncertainty: true }),
      ).resolves.toBe(true);
    });

    it('fails loudly after a prolonged outage instead of delaying forever', async () => {
      failingApi();
      for (let i = 0; i < 30; i++) {
        await expect(
          service.hasActiveExecution('run-2', { boundUncertainty: true }),
        ).resolves.toBe(true);
      }
      await expect(
        service.hasActiveExecution('run-2', { boundUncertainty: true }),
      ).rejects.toThrow(/Unable to verify Kubernetes execution state/);
    });

    it('never throws for unbounded callers such as the stalled-run sweep', async () => {
      failingApi();
      for (let i = 0; i < 40; i++) {
        await expect(service.hasActiveExecution('run-3')).resolves.toBe(true);
      }
    });

    it('resets the uncertainty count once Kubernetes answers', async () => {
      failingApi();
      for (let i = 0; i < 29; i++) {
        await service.hasActiveExecution('run-4', { boundUncertainty: true });
      }
      service['batchApi'] = {
        listNamespacedJob: jest.fn().mockResolvedValue({ items: [] }),
      } as unknown as NonNullable<(typeof service)['batchApi']>;
      await expect(
        service.hasActiveExecution('run-4', { boundUncertainty: true }),
      ).resolves.toBe(false);
      failingApi();
      await expect(
        service.hasActiveExecution('run-4', { boundUncertainty: true }),
      ).resolves.toBe(true);
    });
  });

  describe('kubernetes execution', () => {
    it('retains the numeric exit-code fallback for a generic Kubernetes Error', async () => {
      service['coreApi'] = {
        readNamespacedPod: jest.fn().mockResolvedValue({
          status: {
            containerStatuses: [
              {
                name: 'execution',
                state: { terminated: { exitCode: 1, reason: 'Error' } },
              },
            ],
          },
        }),
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      const outcome = await service['waitForExecutionOutcome'](
        'pod',
        '/tmp/run',
        1000,
        { startedAtMs: null, finishedAtMs: null },
        jest.fn(),
      );
      expect(outcome).toMatchObject({ exitCode: 1, message: undefined });
    });

    it('records container start and finish times as billable evidence', async () => {
      const evidence = { startedAtMs: null, finishedAtMs: null } as {
        startedAtMs: number | null;
        finishedAtMs: number | null;
      };
      service['coreApi'] = {
        readNamespacedPod: jest.fn().mockResolvedValue({
          status: {
            containerStatuses: [
              {
                name: 'execution',
                state: {
                  terminated: {
                    exitCode: 0,
                    startedAt: '2026-10-18T10:00:00.000Z',
                    finishedAt: '2026-10-18T10:00:30.000Z',
                  },
                },
              },
            ],
          },
        }),
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      await service['waitForExecutionOutcome'](
        'pod',
        '/tmp/run',
        1000,
        evidence,
        jest.fn(),
      );
      expect(computeBillableMs(evidence)).toBe(30_000);
    });

    it('bills zero when the container never started', () => {
      expect(computeBillableMs({ startedAtMs: null, finishedAtMs: null })).toBe(
        0,
      );
      expect(
        computeBillableMs({ startedAtMs: null, finishedAtMs: Date.now() }),
      ).toBe(0);
    });

    it('bills zero for a container whose reported start is the zero time', async () => {
      const evidence = { startedAtMs: null, finishedAtMs: null } as {
        startedAtMs: number | null;
        finishedAtMs: number | null;
      };
      service['coreApi'] = {
        readNamespacedPod: jest.fn().mockResolvedValue({
          status: {
            containerStatuses: [
              {
                name: 'execution',
                state: {
                  terminated: {
                    exitCode: 128,
                    reason: 'StartError',
                    startedAt: '1970-01-01T00:00:00Z',
                    finishedAt: '1970-01-01T00:00:00Z',
                  },
                },
              },
            ],
          },
        }),
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      await service['waitForExecutionOutcome'](
        'pod',
        '/tmp/run',
        1000,
        evidence,
        jest.fn(),
      );
      expect(evidence.startedAtMs).toBeNull();
      expect(computeBillableMs(evidence, 1000)).toBe(0);
    });

    it('never bills past the job deadline or a negative span', () => {
      const now = Date.now();
      expect(
        computeBillableMs(
          { startedAtMs: now - 10 * 60_000, finishedAtMs: null },
          60_000,
        ),
      ).toBe(60_000 + 150_000);
      expect(
        computeBillableMs({ startedAtMs: now, finishedAtMs: now - 5_000 }),
      ).toBe(0);
    });

    it('bills a still-running container from its start until now', () => {
      const started = Date.now() - 5_000;
      const billable = computeBillableMs({
        startedAtMs: started,
        finishedAtMs: null,
      });
      expect(billable).toBeGreaterThanOrEqual(5_000);
      expect(billable).toBeLessThan(10_000);
    });

    it('reports OOM termination as failure rather than user cancellation', async () => {
      service['coreApi'] = {
        readNamespacedPod: jest.fn().mockResolvedValue({
          status: {
            containerStatuses: [
              {
                name: 'execution',
                state: { terminated: { exitCode: 137, reason: 'OOMKilled' } },
              },
            ],
          },
        }),
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      const outcome = await service['waitForExecutionOutcome'](
        'pod',
        '/tmp/run',
        1000,
        { startedAtMs: null, finishedAtMs: null },
        jest.fn(),
      );
      expect(outcome).toMatchObject({
        exitCode: 137,
        cancelled: false,
        message: 'OOMKilled',
      });
    });

    it.each([0, 1])(
      'caps log snapshots with %i overflow bytes',
      async (overflow) => {
        const limit = 10 * 1024 * 1024;
        service['logClient'] = {
          log: jest.fn(async (_namespace, _pod, _container, sink: Writable) => {
            sink.write(Buffer.alloc(limit - 2, 'a'));
            sink.end(Buffer.alloc(2 + overflow, 'b'));
          }),
        } as unknown as NonNullable<(typeof service)['logClient']>;
        const output = await service['fetchPodLogsSnapshot']('pod');
        const marker = '\n[Supercheck output truncated at 10 MiB]';
        expect(output).toBe(
          'a'.repeat(limit - 2) + 'bb' + (overflow ? marker : ''),
        );
        expect(service['logClient'].log).toHaveBeenCalledWith(
          expect.any(String),
          'pod',
          'execution',
          expect.any(Writable),
          { follow: false, timestamps: false, limitBytes: limit + 64 * 1024 },
        );
      },
    );

    it.each([false, true])(
      'preserves artifact collection and fails if the pod terminates before collection=%s',
      async (earlyTermination) => {
        service['batchApi'] = {
          createNamespacedJob: jest
            .fn()
            .mockResolvedValue({ metadata: { uid: 'job-uid' } }),
        } as unknown as NonNullable<(typeof service)['batchApi']>;
        service['createExecutionSecret'] = jest
          .fn()
          .mockResolvedValue(undefined);
        service['waitForExecutionPod'] = jest.fn().mockResolvedValue('pod');
        service['waitForExecutionOutcome'] = jest
          .fn()
          .mockImplementation(
            async (
              _pod,
              _workspace,
              _timeout,
              _evidence,
              collect: () => Promise<void>,
            ) => {
              if (!earlyTermination) await collect();
              return { exitCode: 0, timedOut: false, cancelled: false };
            },
          );
        service['startLogStreamWithReconnect'] = jest
          .fn()
          .mockReturnValue(new AbortController());
        service['signalExecutionExit'] = jest.fn().mockResolvedValue(undefined);
        service['extractPodArtifacts'] = jest.fn().mockResolvedValue(undefined);
        service['deleteExecutionJob'] = jest.fn().mockResolvedValue(undefined);
        service['fetchPodLogsSnapshot'] = jest.fn().mockResolvedValue('');
        const result = await service.executeInContainer(null, ['node'], {
          ...defaultOptions,
          extractFromContainer: '/tmp/report',
          extractToHost: '/tmp/host-report',
        });
        expect(result.success).toBe(!earlyTermination);
        if (earlyTermination)
          expect(result.error).toContain('before requested artifacts');
        else {
          expect(service['extractPodArtifacts']).toHaveBeenCalledTimes(1);
          expect(service['signalExecutionExit']).toHaveBeenCalledTimes(1);
        }
      },
    );

    it('does not charge artifact extraction against the execution timeout', async () => {
      let now = 0;
      const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
      service['coreApi'] = {
        readNamespacedPod: jest
          .fn()
          .mockResolvedValueOnce({
            status: {
              containerStatuses: [
                { name: 'execution', state: { running: {} } },
              ],
            },
          })
          .mockResolvedValue({
            status: {
              containerStatuses: [
                { name: 'execution', state: { terminated: { exitCode: 0 } } },
              ],
            },
          }),
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      service['readExecutionExitCode'] = jest.fn().mockResolvedValue(0);
      service['sleep'] = jest.fn().mockResolvedValue(undefined);
      try {
        const outcome = await service['waitForExecutionOutcome'](
          'pod',
          '/tmp/run',
          1000,
          { startedAtMs: null, finishedAtMs: null },
          async () => {
            now = 2000;
          },
        );
        expect(outcome).toMatchObject({ exitCode: 0, timedOut: false });
      } finally {
        clock.mockRestore();
      }
    });

    it('uses Kubernetes exit status even when the tenant writes a successful marker', async () => {
      const statuses = [
        { name: 'execution', state: { running: {} } },
        { name: 'execution', state: { terminated: { exitCode: 7 } } },
      ];
      const readPod = jest.fn().mockImplementation(() =>
        Promise.resolve({
          status: { containerStatuses: [statuses.shift()] },
        }),
      );
      service['coreApi'] = {
        readNamespacedPod: readPod,
      } as unknown as NonNullable<(typeof service)['coreApi']>;
      service['readExecutionExitCode'] = jest.fn().mockResolvedValue(0);
      service['sleep'] = jest.fn().mockResolvedValue(undefined);
      const collectArtifacts = jest.fn().mockResolvedValue(undefined);

      const outcome = await service['waitForExecutionOutcome'](
        'pod',
        '/tmp/supercheck/run-test',
        30000,
        { startedAtMs: null, finishedAtMs: null },
        collectArtifacts,
      );
      expect(outcome.exitCode).toBe(7);
      expect(collectArtifacts).toHaveBeenCalledTimes(1);
      expect(readPod).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])(
      'uses the complete snapshot over replayed logs, retaining the buffer on fetch failure=%s',
      async (snapshotFails) => {
        service['batchApi'] = {
          createNamespacedJob: jest
            .fn()
            .mockResolvedValue({ metadata: { uid: 'job-uid' } }),
        } as unknown as NonNullable<(typeof service)['batchApi']>;
        service['createExecutionSecret'] = jest
          .fn()
          .mockResolvedValue(undefined);
        service['waitForExecutionPod'] = jest.fn().mockResolvedValue('pod');
        service['waitForExecutionOutcome'] = jest.fn().mockResolvedValue({
          exitCode: 0,
          timedOut: false,
          cancelled: false,
        });
        service['startLogStreamWithReconnect'] = jest.fn(
          (_pod: string, sink: Writable) => {
            sink.write('line\nline\n');
            return new AbortController();
          },
        );
        service['signalExecutionExit'] = jest.fn().mockResolvedValue(undefined);
        service['deleteExecutionJob'] = jest.fn().mockResolvedValue(undefined);
        const snapshot = jest.fn().mockResolvedValue('line\n');
        service['fetchPodLogsSnapshot'] = snapshot;
        if (snapshotFails)
          snapshot.mockRejectedValue(new Error('snapshot unavailable'));
        const result = await service.executeInContainer(
          null,
          ['node'],
          defaultOptions,
        );
        expect(result.success).toBe(true);
        expect(result.stdout).toBe(snapshotFails ? 'line\nline\n' : 'line\n');
      },
    );

    it('delegates valid executions to the kubernetes backend', async () => {
      const executeInKubernetes = jest
        .spyOn(service as any, 'executeInKubernetes')
        .mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          duration: 10,
          timedOut: false,
        });

      const result = await service.executeInContainer(
        null,
        ['npx', 'playwright', 'test'],
        defaultOptions,
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('ok');
      expect(executeInKubernetes).toHaveBeenCalledWith(
        ['npx', 'playwright', 'test'],
        defaultOptions,
        expect.objectContaining({
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        }),
      );
    });
  });

  describe('shell script building', () => {
    it('uses a hashed workspace when one is not provided', () => {
      const script = service.buildShellScript(
        {
          ...defaultOptions,
          runId: '../tenant-a',
        },
        ['node', '/tmp/test.spec.ts'],
      );

      expect(script).toContain('/tmp/supercheck/run-');
      expect(script).not.toContain('../tenant-a');
      expect(script).toContain('/tmp/supercheck/run-');
    });

    it('base64-encodes the inline script content', () => {
      const script = service.buildShellScript(
        {
          inlineScriptContent: 'console.log("hello world")',
          inlineScriptFileName: 'test.ts',
          _workspace: '/tmp/supercheck/run-123',
        } as any,
        ['node', 'test.ts'],
      );

      expect(script).toContain(
        Buffer.from('console.log("hello world")').toString('base64'),
      );
      expect(script).toContain('/tmp/supercheck/run-123/test.ts');
      expect(script).toContain("'node' '/tmp/supercheck/run-123/test.ts'");
    });

    it('rewrites /tmp paths into the execution workspace', () => {
      const script = service.buildShellScript(
        {
          ...defaultOptions,
          ensureDirectories: ['/tmp/reports', '/tmp/output'],
          _workspace: '/tmp/supercheck/run-456',
        } as any,
        ['playwright', 'test', '/tmp/test.ts'],
      );

      expect(script).toContain("mkdir -p '/tmp/supercheck/run-456/reports'");
      expect(script).toContain("mkdir -p '/tmp/supercheck/run-456/output'");
      expect(script).toContain(
        "'playwright' 'test' '/tmp/supercheck/run-456/test.ts'",
      );
      expect(script).not.toContain("'/tmp/test.ts'");
    });

    it('rewrites embedded /tmp paths in key=value args', () => {
      const script = service.buildShellScript(
        {
          ...defaultOptions,
          _workspace: '/tmp/supercheck/run-456',
        } as any,
        [
          'k6',
          'run',
          '--out',
          'json=/tmp/k6-output/metrics.json',
          '/tmp/test.js',
        ],
      );

      expect(script).toContain(
        "'json=/tmp/supercheck/run-456/k6-output/metrics.json'",
      );
      expect(script).not.toContain("'json=/tmp/k6-output/metrics.json'");
    });

    it('symlinks node_modules into the workspace', () => {
      const script = service.buildShellScript(
        {
          ...defaultOptions,
          _workspace: '/tmp/supercheck/run-789',
        } as any,
        ['node', 'test.ts'],
      );

      expect(script).toContain(
        'ln -s "$PWD/node_modules" \'/tmp/supercheck/run-789/node_modules\'',
      );
    });
  });

  describe('job spec building', () => {
    it('mounts payload/runtime Secrets without exposing secret values in the Job', () => {
      const job = (service as any).buildExecutionJob({
        jobName: 'sc-exec-secure-payload',
        workspace: '/tmp/supercheck/run-123',
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: {
          ...defaultOptions,
          env: {
            PUBLIC_SETTING: 'visible',
            SUPERCHECK_SECRETS_B64: 'plaintext-secret-material',
          },
        },
        payloadSecretNames: [
          'sc-exec-secure-payload-payload-0',
          'sc-exec-secure-payload-payload-1',
        ],
        runtimeSecretName: 'sc-exec-secure-payload-runtime',
      });

      const podSpec = job.spec.template.spec;
      const container = podSpec.containers[0];
      const serializedJob = JSON.stringify(job);
      const bootstrapScript = container.command[2] as string;

      expect(podSpec.serviceAccountName).toBe('execution-runner');
      expect(podSpec.automountServiceAccountToken).toBe(false);
      expect(container.env).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PUBLIC_SETTING', value: 'visible' }),
        ]),
      );
      expect(container.env).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'SUPERCHECK_SECRETS_B64' }),
        ]),
      );
      expect(podSpec.volumes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'runtime-secrets',
            secret: expect.objectContaining({
              secretName: 'sc-exec-secure-payload-runtime',
            }),
          }),
          expect.objectContaining({
            name: 'payload-0',
            secret: expect.objectContaining({
              secretName: 'sc-exec-secure-payload-payload-0',
            }),
          }),
        ]),
      );
      expect(serializedJob).not.toContain('plaintext-secret-material');
      expect(bootstrapScript).toContain("mkdir -p '/tmp/supercheck/run-123'");
      expect(bootstrapScript.indexOf('mkdir -p')).toBeLessThan(
        bootstrapScript.indexOf('cat '),
      );
    });

    it('uses a unique Kubernetes Job name for each attempt of the same run', () => {
      const runId = '018f0000-0000-7000-8000-000000000001';
      const first = (service as any).buildExecutionJobName(runId);
      const second = (service as any).buildExecutionJobName(runId);

      expect(first).toMatch(/^sc-exec-[a-f0-9]{16}-[a-f0-9]{8}$/);
      expect(second).toMatch(/^sc-exec-[a-f0-9]{16}-[a-f0-9]{8}$/);
      expect(second).not.toBe(first);
    });

    it('does not hardcode node placement by default', () => {
      const job = (service as any).buildExecutionJob({
        jobName: 'sc-exec-test',
        workspace: '/tmp/supercheck/run-123',
        shellScript: "echo 'ok'",
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: defaultOptions,
      });

      expect(job.spec?.template.spec?.runtimeClassName).toBe('gvisor');
      expect(job.spec?.template.spec?.nodeSelector).toBeUndefined();
      expect(job.spec?.template.spec?.tolerations).toBeUndefined();
    });

    describe('execution placement config validation', () => {
      const originalEnv = { ...process.env };
      afterEach(() => {
        process.env = { ...originalEnv };
      });

      const build = (config: Record<string, string>) =>
        new ContainerExecutorService(
          {
            get: jest.fn((key: string, defaultValue?: string) => {
              const all: Record<string, string> = {
                WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
                ...config,
              };
              return all[key] ?? defaultValue;
            }),
          } as any,
          {
            isCancelled: jest.fn().mockResolvedValue(false),
            clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
          } as any,
        );

      it.each(['true', '1'])(
        'allows runtime opt-out for self-hosted production (%s)',
        (value) => {
          process.env.NODE_ENV = 'production';
          process.env.SELF_HOSTED = value;
          expect(() =>
            build({ EXECUTION_RUNTIME_CLASS_NAME: 'none' }),
          ).not.toThrow();
        },
      );

      it('only warns about a malformed selector outside cloud production', () => {
        process.env.NODE_ENV = 'test';
        const svc = build({ EXECUTION_NODE_SELECTOR: 'not-a-pair' });
        expect((svc as any).executionNodeSelector).toBeUndefined();
      });

      describe.each([
        ['malformed key=value selector', { EXECUTION_NODE_SELECTOR: 'region' }],
        ['malformed JSON selector', { EXECUTION_NODE_SELECTOR: '{"region":' }],
        [
          'selector with a dropped entry',
          { EXECUTION_NODE_SELECTOR: '{"region":"eu","bad":1}' },
        ],
        [
          'non-array tolerations',
          { EXECUTION_TOLERATIONS_JSON: '{"key":"a"}' },
        ],
        [
          'tolerations with a non-object item',
          { EXECUTION_TOLERATIONS_JSON: '[{"key":"a"}, 5]' },
        ],
      ])('fails startup in cloud production for %s', (_name, config) => {
        it('throws', () => {
          process.env.NODE_ENV = 'production';
          delete process.env.SELF_HOSTED;
          expect(() =>
            build({ EXECUTION_RUNTIME_CLASS_NAME: 'gvisor', ...config }),
          ).toThrow(/Invalid EXECUTION_/);
        });
      });

      it.each(['1', 'TRUE'])(
        'only warns about mismatched placement for self-hosted production (SELF_HOSTED=%p)',
        (value) => {
          process.env.NODE_ENV = 'production';
          process.env.SELF_HOSTED = value;
          const svc = build({
            EXECUTION_RUNTIME_CLASS_NAME: 'gvisor',
            WORKER_LOCATION: 'asia-pacific',
            EXECUTION_NODE_SELECTOR: 'region=us-east',
          });
          expect((svc as any).executionNodeSelector).toEqual({
            region: 'us-east',
          });
        },
      );

      it('rejects a selector region that does not match WORKER_LOCATION in cloud production', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.SELF_HOSTED;
        expect(() =>
          build({
            EXECUTION_RUNTIME_CLASS_NAME: 'gvisor',
            WORKER_LOCATION: 'asia-pacific',
            EXECUTION_NODE_SELECTOR: 'region=us-east',
          }),
        ).toThrow(/does not match WORKER_LOCATION/);
      });

      it('accepts a valid region selector in cloud production', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.SELF_HOSTED;
        const svc = build({
          EXECUTION_RUNTIME_CLASS_NAME: 'gvisor',
          EXECUTION_NODE_SELECTOR: 'region=eu-central',
        });
        expect((svc as any).executionNodeSelector).toEqual({
          region: 'eu-central',
        });
      });
    });

    it('uses configured runtime class, node selector, and tolerations', () => {
      const configuredService = new ContainerExecutorService(
        {
          get: jest.fn((key: string, defaultValue?: string) => {
            const config: Record<string, string> = {
              WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
              EXECUTION_RUNTIME_CLASS_NAME: 'runsc-sandbox',
              EXECUTION_NODE_SELECTOR: 'tier=execution,pool=sandbox',
              EXECUTION_TOLERATIONS_JSON:
                '[{"key":"dedicated","operator":"Equal","value":"sandbox","effect":"NoSchedule"}]',
            };
            return config[key] ?? defaultValue;
          }),
        } as any,
        {
          isCancelled: jest.fn().mockResolvedValue(false),
          clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
        } as any,
      );

      const job = (configuredService as any).buildExecutionJob({
        jobName: 'sc-exec-test',
        workspace: '/tmp/supercheck/run-123',
        shellScript: "echo 'ok'",
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: defaultOptions,
      });

      expect(job.spec?.template.spec?.runtimeClassName).toBe('runsc-sandbox');
      expect(job.spec?.template.spec?.nodeSelector).toEqual({
        tier: 'execution',
        pool: 'sandbox',
      });
      expect(job.spec?.template.spec?.tolerations).toEqual([
        {
          key: 'dedicated',
          operator: 'Equal',
          value: 'sandbox',
          effect: 'NoSchedule',
        },
      ]);
    });

    it('keeps completed pods alive only until signalled or grace expires', () => {
      const script = (service as any).buildKubernetesWrapperScript(
        "echo 'done'",
        '/tmp/supercheck/run-123/.supercheck-exit-code',
        '/tmp/supercheck/run-123/.supercheck-exit-now',
      );

      expect(script).toContain('.supercheck-exit-code');
      expect(script).toContain('.supercheck-exit-now');
      expect(script).toContain('DEADLINE=$(( $(date +%s) + 300 ))');
      expect(script).toContain('while [ ! -f');
      expect(script).not.toContain('while true; do sleep 5; done');
    });

    it('wrapper exits with the actual exit code, not 0', () => {
      const script = (service as any).buildKubernetesWrapperScript(
        "echo 'done'",
        '/tmp/supercheck/run-123/.supercheck-exit-code',
        '/tmp/supercheck/run-123/.supercheck-exit-now',
      );

      expect(script).toContain('exit $EXIT_CODE');
      expect(script).toContain("trap 'exit $EXIT_CODE' TERM INT");
      // Must NOT exit 0 unconditionally — that hides real failures when
      // exec-based exit code polling is unavailable.
      expect(script).not.toMatch(/exit 0/);
    });

    it('uses ClusterFirst DNS policy by default', () => {
      const job = (service as any).buildExecutionJob({
        jobName: 'sc-exec-dns-test',
        workspace: '/tmp/supercheck/run-123',
        shellScript: "echo 'ok'",
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: defaultOptions,
      });

      expect(job.spec?.template.spec?.dnsPolicy).toBe('ClusterFirst');
      expect(job.spec?.template.spec?.dnsConfig?.options).toEqual([
        { name: 'ndots', value: '1' },
        { name: 'timeout', value: '2' },
        { name: 'attempts', value: '3' },
      ]);
    });

    it('uses dnsPolicy None with custom nameservers when configured', () => {
      const configuredService = new ContainerExecutorService(
        {
          get: jest.fn((key: string, defaultValue?: string) => {
            const config: Record<string, string> = {
              WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
              EXECUTION_DNS_NAMESERVERS: '169.254.20.10,10.43.0.10',
            };
            return config[key] ?? defaultValue;
          }),
        } as any,
        {
          isCancelled: jest.fn().mockResolvedValue(false),
          clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
        } as any,
      );

      const job = (configuredService as any).buildExecutionJob({
        jobName: 'sc-exec-dns-custom',
        workspace: '/tmp/supercheck/run-123',
        shellScript: "echo 'ok'",
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: defaultOptions,
      });

      expect(job.spec?.template.spec?.dnsPolicy).toBe('None');
      expect(job.spec?.template.spec?.dnsConfig?.nameservers).toEqual([
        '169.254.20.10',
        '10.43.0.10',
      ]);
      expect(job.spec?.template.spec?.dnsConfig?.options).toEqual([
        { name: 'ndots', value: '1' },
        { name: 'timeout', value: '2' },
        { name: 'attempts', value: '3' },
      ]);
    });

    it('ignores invalid custom DNS nameservers', () => {
      const configuredService = new ContainerExecutorService(
        {
          get: jest.fn((key: string, defaultValue?: string) => {
            const config: Record<string, string> = {
              WORKER_IMAGE: 'ghcr.io/supercheck-io/worker:test',
              EXECUTION_DNS_NAMESERVERS: '169.254.20.10,999.43.0.10',
            };
            return config[key] ?? defaultValue;
          }),
        } as any,
        {
          isCancelled: jest.fn().mockResolvedValue(false),
          clearCancellationSignal: jest.fn().mockResolvedValue(undefined),
        } as any,
      );

      const job = (configuredService as any).buildExecutionJob({
        jobName: 'sc-exec-dns-invalid',
        workspace: '/tmp/supercheck/run-123',
        shellScript: "echo 'ok'",
        workingDir: '/worker',
        limits: {
          valid: true,
          memoryLimitMb: 512,
          cpuLimit: 0.5,
          timeoutMs: 30000,
        },
        options: defaultOptions,
      });

      expect(job.spec?.template.spec?.dnsPolicy).toBe('None');
      expect(job.spec?.template.spec?.dnsConfig?.nameservers).toEqual([
        '169.254.20.10',
      ]);
    });

    it('backs off outcome polling for longer-running executions', () => {
      const nowSpy = jest.spyOn(Date, 'now');

      nowSpy.mockReturnValue(10_000);
      expect(
        (service as any).getExecutionOutcomePollIntervalMs(0, 60_000),
      ).toBe(1_000);

      nowSpy.mockReturnValue(30_000);
      expect(
        (service as any).getExecutionOutcomePollIntervalMs(0, 120_000),
      ).toBe(2_000);

      nowSpy.mockReturnValue(180_000);
      expect(
        (service as any).getExecutionOutcomePollIntervalMs(0, 300_000),
      ).toBe(5_000);

      nowSpy.mockReturnValue(59_900);
      expect(
        (service as any).getExecutionOutcomePollIntervalMs(0, 60_000),
      ).toBe(250);

      nowSpy.mockRestore();
    });
  });

  describe('log collection', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('keeps the first successful stream complete after startup retries', async () => {
      const forward = jest.fn();
      const collector = service['createLogCollector']({
        onStdoutChunk: forward,
      });
      const log = jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP-Code: 400'))
        .mockImplementationOnce(
          (_namespace, _pod, _container, sink: Writable) => {
            sink.write('first execution line\n');
            return Promise.resolve(new AbortController());
          },
        );
      service['logClient'] = { log } as unknown as NonNullable<
        (typeof service)['logClient']
      >;
      const controller = service['startLogStreamWithReconnect'](
        'pod',
        collector.stream,
        'job',
      );
      await jest.advanceTimersByTimeAsync(2_000);
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls[1][4]).not.toHaveProperty('sinceSeconds');
      expect(forward).toHaveBeenCalledWith('first execution line\n');
      controller.abort();
    });

    it.each(['close', 'error'])(
      'reconnects on response %s without ending the collector',
      async (event) => {
        const collector = service['createLogCollector']({});
        const sources: PassThrough[] = [];
        const requests: AbortController[] = [];
        const log = jest
          .fn()
          .mockImplementation(
            (_namespace, _pod, _container, sink: Writable) => {
              const source = new PassThrough();
              const request = new AbortController();
              sources.push(source);
              requests.push(request);
              source.pipe(sink);
              return Promise.resolve(request);
            },
          );
        service['logClient'] = { log } as unknown as NonNullable<
          (typeof service)['logClient']
        >;
        const controller = service['startLogStreamWithReconnect'](
          'pod',
          collector.stream,
          'job',
        );
        await jest.advanceTimersByTimeAsync(0);
        sources[0].write('before disconnect\n');
        if (event === 'error')
          sources[0].emit('error', new Error('ECONNRESET'));
        else sources[0].end();
        await jest.advanceTimersByTimeAsync(2_000);
        expect(log).toHaveBeenCalledTimes(2);
        expect(collector.stream.writableEnded).toBe(false);
        expect(requests[0].signal.aborted).toBe(true);
        expect(log.mock.calls[1][4]).toMatchObject({ sinceSeconds: 5 });
        sources[1].write('after reconnect\n');
        expect(collector.getOutput()).toBe(
          'before disconnect\nafter reconnect\n',
        );
        controller.abort();
      },
    );

    it('aborts a request that becomes ready after execution cleanup', async () => {
      const collector = service['createLogCollector']({});
      let ready!: (request: AbortController) => void;
      const log = jest.fn().mockReturnValue(
        new Promise<AbortController>((resolve) => {
          ready = resolve;
        }),
      );
      service['logClient'] = { log } as unknown as NonNullable<
        (typeof service)['logClient']
      >;
      const controller = service['startLogStreamWithReconnect'](
        'pod',
        collector.stream,
        'job',
      );
      controller.abort();
      const request = new AbortController();
      ready(request);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(request.signal.aborted).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('cancels a pending reconnect when execution cleanup aborts', async () => {
      const collector = service['createLogCollector']({});
      const log = jest.fn().mockRejectedValue(new Error('HTTP-Code: 400'));
      service['logClient'] = { log } as unknown as NonNullable<
        (typeof service)['logClient']
      >;
      const controller = service['startLogStreamWithReconnect'](
        'pod',
        collector.stream,
        'job',
      );
      await jest.advanceTimersByTimeAsync(0);
      controller.abort();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('suppresses live forwarding during replay windows', async () => {
      const onStdoutChunk = jest.fn();
      const collector = (service as any).createLogCollector({
        onStdoutChunk,
      });

      collector.stream.write('line-1\n');
      collector.stream.suppressLiveForwarding();
      collector.stream.write('line-2\n');
      collector.stream.resumeLiveForwarding();
      collector.stream.write('line-3\n');

      expect(onStdoutChunk).toHaveBeenCalledTimes(2);
      expect(onStdoutChunk).toHaveBeenNthCalledWith(1, 'line-1\n');
      expect(onStdoutChunk).toHaveBeenNthCalledWith(2, 'line-3\n');
      expect(collector.getOutput()).toBe('line-1\nline-2\nline-3\n');
    });
  });

  describe('waitForExecutionPod', () => {
    it('returns pod name as soon as the pod exists, even while Pending', async () => {
      (service as any).coreApi = {
        listNamespacedPod: jest.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'sc-exec-abc123' },
              status: { phase: 'Pending' },
            },
          ],
        }),
      };

      const podName = await (service as any).waitForExecutionPod('test-job');
      expect(podName).toBe('sc-exec-abc123');
    });
  });
});
