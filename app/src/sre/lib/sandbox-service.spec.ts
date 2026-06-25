import {
  AgentSandboxService,
  AgentSandboxUnavailableError,
  KubernetesAgentSandboxAdapter,
  buildAgentSandboxPodManifest,
  createAgentSandboxService,
  type AgentSandboxAdapter,
} from "./sandbox-service";

const options = {
  namespace: "supercheck-execution",
  image: "ghcr.io/supercheck-io/agent-workspace:test",
  organizationId: "018f0000-0000-7000-8000-000000000001",
  projectId: "018f0000-0000-7000-8000-000000000002",
  investigationId: "018f0000-0000-7000-8000-000000000003",
  readyTimeoutMs: 5000,
  pollIntervalMs: 0,
};

function createAdapter(phases: Array<string | null> = ["Running"]): jest.Mocked<AgentSandboxAdapter> {
  const phaseQueue = [...phases];
  return {
    createPod: jest.fn().mockResolvedValue(undefined),
    readPodPhase: jest.fn().mockImplementation(async () => phaseQueue.shift() ?? "Running"),
    exec: jest.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
    deletePod: jest.fn().mockResolvedValue(undefined),
  };
}

describe("AgentSandboxService", () => {
  const originalEnabled = process.env.SRE_AGENT_SANDBOX_ENABLED;
  const originalExecutionRuntimeClassName = process.env.EXECUTION_RUNTIME_CLASS_NAME;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.SRE_AGENT_SANDBOX_ENABLED;
    } else {
      process.env.SRE_AGENT_SANDBOX_ENABLED = originalEnabled;
    }
    delete process.env.SRE_AGENT_SANDBOX_IMAGE;
    delete process.env.SRE_AGENT_SANDBOX_RUNTIME_CLASS_NAME;
    if (originalExecutionRuntimeClassName === undefined) {
      delete process.env.EXECUTION_RUNTIME_CLASS_NAME;
    } else {
      process.env.EXECUTION_RUNTIME_CLASS_NAME = originalExecutionRuntimeClassName;
    }
  });

  it("fails closed when the sandbox feature gate is disabled", () => {
    delete process.env.SRE_AGENT_SANDBOX_ENABLED;

    expect(() => createAgentSandboxService(options, createAdapter())).toThrow(AgentSandboxUnavailableError);
  });

  it("uses the Kubernetes adapter by default when enabled", () => {
    process.env.SRE_AGENT_SANDBOX_ENABLED = "true";

    expect(createAgentSandboxService(options)).toBeInstanceOf(AgentSandboxService);
    expect(createAgentSandboxService(options)).toHaveProperty("adapter", expect.any(KubernetesAgentSandboxAdapter));
  });

  it("builds a hardened gVisor workspace pod manifest", () => {
    const manifest = buildAgentSandboxPodManifest(options) as {
      metadata: { name: string; labels: Record<string, string> };
      spec: {
        automountServiceAccountToken: boolean;
        enableServiceLinks: boolean;
        activeDeadlineSeconds: number;
        runtimeClassName: string;
        securityContext: Record<string, unknown>;
        containers: Array<{
          name: string;
          image: string;
          securityContext: Record<string, unknown>;
          volumeMounts: Array<{ name: string; mountPath: string }>;
        }>;
      };
    };

    expect(manifest.metadata.name).toMatch(/^sc-sre-agent-/);
    expect(manifest.metadata.labels["supercheck.io/organization-id"]).toBe(options.organizationId);
    expect(manifest.spec.activeDeadlineSeconds).toBe(3600);
    expect(manifest.spec.automountServiceAccountToken).toBe(false);
    expect(manifest.spec.enableServiceLinks).toBe(false);
    expect(manifest.spec.runtimeClassName).toBe("gvisor");
    expect(manifest.spec.securityContext).toEqual(expect.objectContaining({ runAsNonRoot: true }));
    expect(manifest.spec.containers[0]).toEqual(expect.objectContaining({
      name: "workspace",
      image: options.image,
      securityContext: expect.objectContaining({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ["ALL"] },
      }),
    }));
    expect(manifest.spec.containers[0].volumeMounts).toEqual(expect.arrayContaining([
      { name: "workspace", mountPath: "/workspace" },
      { name: "tmp", mountPath: "/tmp" },
    ]));
  });

  it("fails closed when runtime class isolation is disabled", () => {
    process.env.EXECUTION_RUNTIME_CLASS_NAME = "none";

    expect(() => buildAgentSandboxPodManifest(options)).toThrow("SRE agent sandbox requires an isolated runtimeClassName");
  });

  it("starts, executes through the adapter, and disposes idempotently", async () => {
    const adapter = createAdapter(["Pending", "Running"]);
    const service = new AgentSandboxService(options, adapter);

    await service.start();
    const result = await service.exec("jq --version", {
      cwd: "/workspace",
      env: { CHECK_NAME: "checkout" },
      timeoutMs: 2500,
    });
    await service.dispose();
    await service.dispose();

    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    expect(adapter.createPod).toHaveBeenCalledWith(options.namespace, expect.objectContaining({ kind: "Pod" }));
    expect(adapter.readPodPhase).toHaveBeenCalledTimes(2);
    expect(adapter.exec).toHaveBeenCalledWith(options.namespace, service.getPodName(), "workspace", [
      "timeout",
      "3",
      "sh",
      "-c",
      "export CHECK_NAME='checkout'; cd '/workspace' && jq --version",
    ]);
    expect(adapter.deletePod).toHaveBeenCalledTimes(1);
  });

  it("blocks file operations outside workspace directories", async () => {
    const service = new AgentSandboxService(options, createAdapter());
    await service.start();

    await expect(service.readFile("/etc/passwd")).rejects.toThrow("Sandbox file paths must be under /workspace or /tmp");
    await expect(service.writeFile("/root/.env", "secret")).rejects.toThrow("Sandbox file paths must be under /workspace or /tmp");
  });

  it("fails if the sandbox pod terminates before becoming ready", async () => {
    const service = new AgentSandboxService(options, createAdapter(["Failed"]));

    await expect(service.start()).rejects.toThrow("Sandbox pod terminated early: Failed");
  });
});
