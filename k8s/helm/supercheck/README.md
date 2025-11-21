# Supercheck Helm Chart (K3s / Civo)

Opinionated Helm chart to run the Supercheck app (Next.js) and worker (NestJS) on a Civo K3s cluster. Backing services (Postgres, Redis, S3/R2) default to **external managed** endpoints for production use; optional in-cluster dependencies can be enabled for demos.

## Prerequisites
- Kubernetes 1.27+ (tested on Civo K3s)
- Ingress controller (e.g., Traefik on Civo, NGINX Ingress works too)
- TLS certs handled by your issuer (optional but recommended)
- External Postgres, Redis, and S3-compatible storage (e.g., Cloudflare R2)
- kubectl & helm installed

## Key Values to set (external-first)
```yaml
global:
  appUrl: https://app.supercheck.example.com
  statusPageDomain: status.supercheck.example.com

config:
  database:
    host: postgres.example.com
    port: 5432
    name: supercheck
    user: supercheck
  redis:
    host: redis.example.com
    port: 6379
  s3:
    endpoint: https://<r2-account-id>.r2.cloudflarestorage.com
    region: auto
    forcePathStyle: true   # R2 is path-style; set false if using virtual-hosted S3
    bucketNames:
      job: supercheck-job
      test: supercheck-test
      monitor: supercheck-monitor
      status: supercheck-status
      performance: supercheck-performance

secrets:
  create: true
  databasePassword: "strong-db-pass"
  redisPassword: "strong-redis-pass"
  s3AccessKey: "<r2-access-key>"
  s3SecretKey: "<r2-secret-key>"
  betterAuthSecret: "<32+ char random hex>"
  variablesEncryptionKey: "<64-char hex>"
  credentialEncryptionKey: "<64-char hex>"
  smtpPassword: "<smtp-password>"
  openaiApiKey: "<openai>"

app:
  ingress:
    enabled: true
    className: traefik
    hosts:
      - host: app.supercheck.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: supercheck-tls
        hosts:
          - app.supercheck.example.com
```

## Deploy
```bash
helm upgrade --install supercheck charts/supercheck \
  --namespace supercheck --create-namespace \
  -f my-values.yaml
```

## Executor (Docker) options
- Default: DinD sidecar (`worker.executor.mode=dind`) exposing `DOCKER_HOST=tcp://localhost:2375` to the worker.
- To use a host Docker socket (only if cluster nodes run Docker and you accept the risk):
  - `worker.executor.mode=hostdocker`
  - `worker.executor.hostSocketPath=/var/run/docker.sock`

## Optional in-cluster deps (for demos only)
- Set `postgres.enabled=true`, `redis.enabled=true`, or `minio.enabled=true` to run them inside the cluster. Defaults are **false** for production-readiness.

## Ports
- App: 3000 (ClusterIP service)
- Worker: 8000 (ClusterIP service)
- MinIO (optional): 9000 API / 9001 console

## Backups & persistence
- When in-cluster Postgres/Redis/MinIO are enabled, PVCs are created (storage class from `global.storageClass` or component-specific overrides).

## Notes for Civo K3s
- Traefik is installed by default; set `app.ingress.className=traefik`.
- Use `global.storageClass=longhorn` if Longhorn is enabled in your cluster.
- If running DinD, ensure nodes allow privileged pods (default true on K3s) and allocate enough disk (`worker.executor.dind.storageSize` or `hostPathForStorage`).
