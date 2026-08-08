jest.mock('fs/promises');

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ContainerExecutionOptions,
  ContainerExecutorService,
} from './container-executor.service';
import { CancellationService } from '../services/cancellation.service';
import { EventEmitter } from 'events';

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

  describe('kubernetes execution', () => {
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
