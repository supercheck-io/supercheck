# Security Module - gVisor Execution

This module is the worker-side execution boundary for untrusted Playwright and k6 code.

## Overview

`ContainerExecutorService` no longer shells out to Docker. The worker now creates a per-run Kubernetes Job in `supercheck-execution`, and the execution container runs under gVisor (`runtimeClassName: gvisor`).

The long-lived worker remains a control plane only:

- Prepares inline scripts and runtime environment
- Creates and watches execution Jobs through `@kubernetes/client-node`
- Streams logs back to callers
- Extracts reports from the still-running pod
- Uploads artifacts, then deletes the Job

## Security Model

Execution pods are hardened in multiple layers:

- `runtimeClassName: gvisor` for userspace-kernel syscall isolation
- `runAsNonRoot: true`, `runAsUser: 1000`, `runAsGroup: 1000`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `capabilities.drop: ["ALL"]`
- `seccompProfile.type: RuntimeDefault`
- `automountServiceAccountToken: false`
- `enableServiceLinks: false`

The worker ServiceAccount has a namespace-scoped `execution-manager` Role in `supercheck-execution` only (defined in `deploy/docker/setup-k3s.sh`):

| Resource | Verbs | Why |
|----------|-------|-----|
| `jobs` (batch) | create, get, list, watch, delete, deletecollection | Run and clean up execution Jobs |
| `pods` | get, list, watch, delete | Find and watch the Job's pod |
| `pods/log` | get | Stream and snapshot output |
| `pods/exec` | get, create | Poll the exit file and extract reports |
| `events` | get, list | Fail fast when the cluster rejects the Job's pod (`FailedCreate`); optional, a 403 only delays that failure to the 120 s pod timeout |
| `secrets` | create | Ephemeral Job-owned payload/runtime Secrets (not readable by the worker) |

Execution pods do not receive Kubernetes credentials.

### Network isolation check (fail closed)

Every execution Job has an `egress-wait` init container that probes the Kubernetes API Service. If it stays reachable for 20 s the NetworkPolicy is not being enforced, so the pod exits 78 and user code never starts. The run is reported as `Infrastructure error: execution network isolation not enforced; the run was not started`, is not billed and is not a test failure. If admission control rejects the pod instead (for example a policy that denies init containers), the worker reads the Job's `FailedCreate` events and fails the run immediately with `Infrastructure error: Execution pod was rejected by the cluster: <reason>`.

### Log collectors

Execution pod templates carry `supercheck.io/scrape-logs: "false"`. The worker streams pod output itself and redacts secrets before storing it, so a cluster log collector (Promtail, Vector, Fluent Bit, ...) must not also ship the raw lines. Supercheck does not install a collector; if you run one, configure it to drop pods with this annotation (it is a convention, not enforced by Kubernetes) or exclude the `supercheck-execution` namespace.

## Workspace Isolation

Each run gets a unique workspace under `/tmp/supercheck/run-{hash}`.

- Caller-supplied `/tmp/...` paths are rewritten into that workspace
- Additional files are normalized to stay inside the workspace
- Artifact extraction is refused if the resolved path escapes the workspace
- `/dev/shm` is provided as a dedicated `emptyDir` tmpfs for Chromium

This prevents cross-run file contamination and makes cleanup deterministic when the Job is deleted.

## Artifact Extraction

The worker keeps the pod alive briefly after the user process exits:

1. The wrapper script records the real exit code to a file.
2. The worker polls that file via `pods/exec`.
3. The worker streams a tar archive of the requested report directory.
4. Tar entries are validated before extraction.
5. The worker signals the pod to exit and deletes the Job.

Safety checks include:

- Max artifact archive size: 100 MB
- Reject absolute paths and `..` traversal
- Reject symlinks, hard links, devices, FIFOs, and other unsafe tar entry types

## Resource Model

The public execution API still accepts:

- `memoryLimitMb`
- `cpuLimit`
- `timeoutMs`

The Kubernetes pod spec adds execution overhead automatically:

- `512 Mi` for `/dev/shm`
- `150 Mi` for gVisor Sentry overhead
- `1 Gi` ephemeral-storage request by default
- `8 Gi` ephemeral-storage limit and `/tmp` `emptyDir.sizeLimit` by default

This avoids under-sizing the pod compared with the caller-visible memory budget.

Storage defaults can be tuned with:

- `EXECUTION_EPHEMERAL_STORAGE_REQUEST`
- `EXECUTION_EPHEMERAL_STORAGE_LIMIT`
- `EXECUTION_TMP_EMPTYDIR_SIZE_LIMIT`

Keep the `/tmp` size limit at or below the container ephemeral-storage limit so
Playwright/k6 temp files cannot exhaust node inodes or disk outside Kubernetes
eviction accounting.

## DNS and Networking

Execution pods default to:

- `dnsPolicy: ClusterFirst`
- `dnsConfig.options: ndots=1, timeout=2, attempts=3`

If `EXECUTION_DNS_NAMESERVERS` is set on the worker, execution pods switch to `dnsPolicy: None` with those validated IPv4 nameservers. The `execution-egress` NetworkPolicy only allows DNS to CoreDNS, so add a matching DNS rule for those nameservers or lookups in execution pods will fail.

Network access is enforced by Kubernetes `NetworkPolicy`, not by Docker flags:

- No inbound traffic
- DNS allowed
- Outbound TCP allowed only to public IPs
- Private ranges, metadata endpoints, and link-local addresses blocked

## Operational Notes

- Cancellation deletes the Job and forces exit code `137`
- Completion is determined by exit-code polling, not by log-stream lifecycle
- Log follow reconnects automatically; the worker also fetches a final snapshot
- `stderr` is not separated by Kubernetes log streaming and is folded into `stdout`

## Key Files

- `container-executor.service.ts`: Job creation, log streaming, extraction, cleanup
- `container-executor.service.spec.ts`: Unit tests for pod spec generation and validation
- `path-validator.ts`: Reusable path and argument validation helpers
- `egress-guard.ts`: Init-container script behind the fail-closed isolation check
- `deploy/docker/setup-k3s.sh`: RBAC, RuntimeClass, NetworkPolicy, quota and host metadata rule (`--execution-plane-only` re-applies the manifests alone)
