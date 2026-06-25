import { Buffer } from "buffer";
import { Writable } from "stream";
import type * as k8s from "@kubernetes/client-node";
import { z } from "zod";

import { createLogger } from "@/lib/logger/index";
import { isSreAgentSandboxEnabled } from "@/sre/lib/feature-gates";

const logger = createLogger({ module: "sre-sandbox" }) as {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

const DEFAULT_NAMESPACE = "supercheck-execution";
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_CPU_REQUEST = "500m";
const DEFAULT_MEMORY_REQUEST = "512Mi";
const DEFAULT_CPU_LIMIT = "1000m";
const DEFAULT_MEMORY_LIMIT = "1Gi";
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const EXEC_EXIT_CODE_MARKER = "__SUPERCHECK_SRE_SANDBOX_EXIT_CODE__:";

const uuidSchema = z.string().uuid();
const dnsLabelSchema = z.string().min(1).max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
const imageSchema = z.string().min(1).max(300).regex(/^[A-Za-z0-9._/:@-]+$/);
const resourceSchema = z.string().min(1).max(32).regex(/^[0-9]+(?:m|Mi|Gi)?$/);

const sandboxOptionsSchema = z.object({
  namespace: dnsLabelSchema.default(DEFAULT_NAMESPACE),
  image: imageSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  investigationId: uuidSchema,
  runtimeClassName: dnsLabelSchema.optional(),
  ttlSeconds: z.number().int().min(60).max(14_400).default(DEFAULT_TTL_SECONDS),
  cpuRequest: resourceSchema.default(DEFAULT_CPU_REQUEST),
  memoryRequest: resourceSchema.default(DEFAULT_MEMORY_REQUEST),
  cpuLimit: resourceSchema.default(DEFAULT_CPU_LIMIT),
  memoryLimit: resourceSchema.default(DEFAULT_MEMORY_LIMIT),
  readyTimeoutMs: z.number().int().min(1_000).max(300_000).default(DEFAULT_READY_TIMEOUT_MS),
  pollIntervalMs: z.number().int().min(0).max(10_000).default(1_000),
});

const execOptionsSchema = z.object({
  cwd: z.string().min(1).max(500).optional(),
  env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(4000)).optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(DEFAULT_EXEC_TIMEOUT_MS),
});

export type AgentSandboxOptions = z.input<typeof sandboxOptionsSchema>;
export type NormalizedAgentSandboxOptions = z.output<typeof sandboxOptionsSchema>;

export type SandboxExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type AgentSandboxPodManifest = Record<string, unknown>;

export type AgentSandboxAdapter = {
  createPod(namespace: string, manifest: AgentSandboxPodManifest): Promise<void>;
  readPodPhase(namespace: string, podName: string): Promise<string | null>;
  exec(namespace: string, podName: string, containerName: string, command: string[]): Promise<SandboxExecResult>;
  deletePod(namespace: string, podName: string): Promise<void>;
};

export class AgentSandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSandboxUnavailableError";
  }
}

function sanitizePodName(investigationId: string) {
  const suffix = investigationId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 36);
  return `sc-sre-agent-${suffix}`.slice(0, 63).replace(/-+$/g, "");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isKubernetesNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.includes("NotFound") || message.includes("not found");
}

function isKubernetesAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("409") || message.includes("AlreadyExists") || message.includes("already exists");
}

function assertSandboxPath(path: string) {
  if (path.includes("\0") || (!path.startsWith("/workspace/") && !path.startsWith("/tmp/"))) {
    throw new Error("Sandbox file paths must be under /workspace or /tmp");
  }
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimeClassName(input?: string) {
  const raw = input ?? process.env.SRE_AGENT_SANDBOX_RUNTIME_CLASS_NAME ?? process.env.EXECUTION_RUNTIME_CLASS_NAME ?? "gvisor";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "none") {
    throw new AgentSandboxUnavailableError("SRE agent sandbox requires an isolated runtimeClassName");
  }
  return trimmed;
}

export function normalizeAgentSandboxOptions(input: AgentSandboxOptions): NormalizedAgentSandboxOptions {
  return sandboxOptionsSchema.parse({
    namespace: input.namespace ?? process.env.SRE_AGENT_SANDBOX_NAMESPACE ?? DEFAULT_NAMESPACE,
    image: input.image ?? process.env.SRE_AGENT_SANDBOX_IMAGE,
    organizationId: input.organizationId,
    projectId: input.projectId,
    investigationId: input.investigationId,
    runtimeClassName: resolveRuntimeClassName(input.runtimeClassName),
    ttlSeconds: input.ttlSeconds,
    cpuRequest: input.cpuRequest,
    memoryRequest: input.memoryRequest,
    cpuLimit: input.cpuLimit,
    memoryLimit: input.memoryLimit,
    readyTimeoutMs: input.readyTimeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  });
}

export function buildAgentSandboxPodManifest(input: AgentSandboxOptions): AgentSandboxPodManifest {
  const opts = normalizeAgentSandboxOptions(input);
  const podName = sanitizePodName(opts.investigationId);

  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName,
      namespace: opts.namespace,
      labels: {
        "app.kubernetes.io/managed-by": "supercheck-sre",
        "app.kubernetes.io/component": "agent-workspace",
        app: "sre-agent-workspace",
        "supercheck.io/organization-id": opts.organizationId,
        "supercheck.io/project-id": opts.projectId,
        "supercheck.io/investigation-id": opts.investigationId,
      },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: opts.ttlSeconds,
      terminationGracePeriodSeconds: 1,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      runtimeClassName: opts.runtimeClassName,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "workspace",
          image: opts.image,
          imagePullPolicy: "IfNotPresent",
          command: ["sleep", String(opts.ttlSeconds)],
          workingDir: "/workspace",
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            capabilities: { drop: ["ALL"] },
            seccompProfile: { type: "RuntimeDefault" },
          },
          resources: {
            requests: { cpu: opts.cpuRequest, memory: opts.memoryRequest },
            limits: { cpu: opts.cpuLimit, memory: opts.memoryLimit },
          },
          volumeMounts: [
            { name: "workspace", mountPath: "/workspace" },
            { name: "tmp", mountPath: "/tmp" },
          ],
        },
      ],
      volumes: [
        { name: "workspace", emptyDir: {} },
        { name: "tmp", emptyDir: {} },
      ],
    },
  };
}

export class AgentSandboxService {
  private readonly opts: NormalizedAgentSandboxOptions;
  private readonly podName: string;
  private started = false;
  private disposed = false;

  constructor(options: AgentSandboxOptions, private readonly adapter: AgentSandboxAdapter) {
    this.opts = normalizeAgentSandboxOptions(options);
    this.podName = sanitizePodName(this.opts.investigationId);
  }

  getPodName() {
    return this.podName;
  }

  getNamespace() {
    return this.opts.namespace;
  }

  buildPodManifest() {
    return buildAgentSandboxPodManifest(this.opts);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.adapter.createPod(this.opts.namespace, this.buildPodManifest());
    await this.waitForPodReady();
    this.started = true;
    logger.info({ podName: this.podName, investigationId: this.opts.investigationId }, "Agent sandbox pod ready");
  }

  async exec(command: string, options: z.input<typeof execOptionsSchema> = {}): Promise<SandboxExecResult> {
    if (!this.started || this.disposed) {
      throw new Error("Agent sandbox must be started before exec");
    }

    const parsed = execOptionsSchema.parse(options);
    if (parsed.cwd) assertSandboxPath(parsed.cwd.endsWith("/") ? `${parsed.cwd}.` : `${parsed.cwd}/.`);
    const envPrefix = parsed.env
      ? `${Object.entries(parsed.env).map(([key, value]) => `export ${key}=${shellQuote(value)}`).join("; ")};`
      : "";
    const cdPrefix = parsed.cwd ? `cd ${shellQuote(parsed.cwd)} &&` : "";
    const fullCommand = [envPrefix, cdPrefix, command].filter(Boolean).join(" ");
    const timeoutSeconds = Math.ceil(parsed.timeoutMs / 1000);

    return this.adapter.exec(this.opts.namespace, this.podName, "workspace", [
      "timeout",
      String(timeoutSeconds),
      "sh",
      "-c",
      fullCommand,
    ]);
  }

  async readFile(path: string): Promise<string> {
    assertSandboxPath(path);
    const result = await this.exec(`cat ${shellQuote(path)}`);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Failed to read sandbox file");
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    assertSandboxPath(path);
    const encoded = Buffer.from(content, "utf8").toString("base64");
    const result = await this.exec(`printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Failed to write sandbox file");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.adapter.deletePod(this.opts.namespace, this.podName);
      logger.info({ podName: this.podName }, "Agent sandbox pod deleted");
    } catch (error) {
      logger.warn({ err: error, podName: this.podName }, "Failed to delete agent sandbox pod");
    }
  }

  private async waitForPodReady(): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.opts.readyTimeoutMs) {
      const phase = await this.adapter.readPodPhase(this.opts.namespace, this.podName);
      if (phase === "Running") return;
      if (phase === "Failed" || phase === "Succeeded") {
        throw new Error(`Sandbox pod terminated early: ${phase}`);
      }
      await sleep(this.opts.pollIntervalMs);
    }
    throw new Error(`Sandbox pod ${this.podName} did not become ready within ${this.opts.readyTimeoutMs}ms`);
  }
}

export class KubernetesAgentSandboxAdapter implements AgentSandboxAdapter {
  private k8sModule: typeof k8s | null = null;
  private kubeConfig: k8s.KubeConfig | null = null;
  private coreApi: k8s.CoreV1Api | null = null;
  private execClient: k8s.Exec | null = null;

  async createPod(namespace: string, manifest: AgentSandboxPodManifest): Promise<void> {
    await this.ensureClients();

    const podName = String((manifest.metadata as { name?: string } | undefined)?.name ?? "");
    try {
      await this.coreApi!.createNamespacedPod({
        namespace,
        body: manifest as k8s.V1Pod,
      });
    } catch (error) {
      if (!isKubernetesAlreadyExistsError(error)) {
        throw error;
      }

      const existingPhase = podName ? await this.readPodPhase(namespace, podName) : null;
      if (existingPhase === "Failed" || existingPhase === "Succeeded") {
        await this.deletePod(namespace, podName);
        await this.coreApi!.createNamespacedPod({
          namespace,
          body: manifest as k8s.V1Pod,
        });
        return;
      }

      throw new Error(`Agent sandbox pod ${podName || "unknown"} already exists with phase ${existingPhase ?? "unknown"}`);
    }
  }

  async readPodPhase(namespace: string, podName: string): Promise<string | null> {
    await this.ensureClients();

    try {
      const pod = await this.coreApi!.readNamespacedPod({ name: podName, namespace });
      return pod.status?.phase ?? null;
    } catch (error) {
      if (isKubernetesNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async exec(
    namespace: string,
    podName: string,
    containerName: string,
    command: string[],
  ): Promise<SandboxExecResult> {
    await this.ensureClients();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdout = new Writable({
      write: (chunk, _encoding, callback) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        callback();
      },
    });
    const stderr = new Writable({
      write: (chunk, _encoding, callback) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        callback();
      },
    });
    const wrappedCommand = `${command.map(shellQuote).join(" ")}; exit_code=$?; printf '\n${EXEC_EXIT_CODE_MARKER}%s\n' "$exit_code" >&2; exit 0`;

    const socket = await this.execClient!.exec(
      namespace,
      podName,
      containerName,
      ["/bin/sh", "-c", wrappedCommand],
      stdout,
      stderr,
      null,
      false,
    );

    await new Promise<void>((resolve, reject) => {
      socket.on("close", () => resolve());
      socket.on("error", (error: unknown) => reject(error));
    });

    const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");
    const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
    const exitMatch = rawStderr.match(new RegExp(`\\n?${EXEC_EXIT_CODE_MARKER}(\\d+)\\n?`));
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? "1", 10) : 1;
    const stderrText = rawStderr.replace(new RegExp(`\\n?${EXEC_EXIT_CODE_MARKER}\\d+\\n?`), "").trimStart();

    return {
      stdout: stdoutText,
      stderr: stderrText,
      exitCode: Number.isFinite(exitCode) ? exitCode : 1,
    };
  }

  async deletePod(namespace: string, podName: string): Promise<void> {
    await this.ensureClients();

    try {
      await this.coreApi!.deleteNamespacedPod({
        name: podName,
        namespace,
        gracePeriodSeconds: 0,
      });
    } catch (error) {
      if (!isKubernetesNotFoundError(error)) {
        throw error;
      }
    }
  }

  private async ensureClients(): Promise<void> {
    if (this.kubeConfig && this.coreApi && this.execClient) {
      return;
    }

    const k8sModule = this.k8sModule || (await import("@kubernetes/client-node"));
    this.k8sModule = k8sModule;

    const kubeConfig = new k8sModule.KubeConfig();
    kubeConfig.loadFromDefault();

    this.kubeConfig = kubeConfig;
    this.coreApi = kubeConfig.makeApiClient(k8sModule.CoreV1Api);
    this.execClient = new k8sModule.Exec(kubeConfig);
  }
}

export function createAgentSandboxService(options: AgentSandboxOptions, adapter?: AgentSandboxAdapter) {
  if (!isSreAgentSandboxEnabled()) {
    throw new AgentSandboxUnavailableError("SRE agent sandbox is disabled");
  }

  return new AgentSandboxService(options, adapter ?? new KubernetesAgentSandboxAdapter());
}
