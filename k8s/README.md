# Supercheck plain Kubernetes manifests

Production-leaning manifests for a vanilla Kubernetes cluster (non-Helm). Backing services (Postgres, Redis, S3/R2) are external by default; DinD sidecar is used for the worker to run Playwright/K6 in containers. Helm chart is now located under `k8s/helm/supercheck` for clusters that prefer Helm packaging.

## Files
- `kustomization.yaml` — bundles all manifests under `supercheck` namespace.
- `namespace.yaml` — creates `supercheck` namespace.
- `serviceaccount.yaml` — dedicated SA for app/worker.
- `configmap.yaml` — non-secret configuration (edit to match your endpoints, domains, buckets).
- `secret.yaml` — sample secrets (replace placeholders; consider SealedSecrets/ExternalSecrets).
- `app-deployment.yaml` / `app-service.yaml` — Next.js app (port 3000).
- `worker-deployment.yaml` / `worker-service.yaml` — NestJS worker (port 8000) with DinD sidecar.
- `ingress.yaml` — exposes the app host (Traefik class, adjust for your controller).
- `pdb-app.yaml` / `pdb-worker.yaml` — Pod disruption budgets.

## Quick start
1) Edit secrets and endpoints:
   - `k8s/configmap.yaml`: set `NEXT_PUBLIC_APP_URL`, `APP_URL`, `STATUS_PAGE_DOMAIN`, `DB_*`, `REDIS_*`, `S3_*` values.
   - `k8s/secret.yaml`: replace placeholder credentials (DB/Redis/S3 keys, BetterAuth/Encryption keys, SMTP/OpenAI).
2) (Optional) Pin ingress class/hosts/TLS secret in `k8s/ingress.yaml`.
3) Apply:
```bash
kubectl apply -k k8s
kubectl -n supercheck get pods
```

## Notes / best practices
- Use managed Postgres/Redis/S3 (Cloudflare R2) and keep `configmap.yaml` pointing to those endpoints.
- Replace `secret.yaml` with your secret manager (ExternalSecrets/SealedSecrets) for real deployments.
- DinD sidecar is privileged; ensure node policy allows it. If you have host Docker and accept the risk, switch to socket sharing by removing the DinD container, mounting `/var/run/docker.sock`, and changing `DOCKER_HOST` to `unix:///var/run/docker.sock`.
- Adjust resource requests/limits for your cluster capacity; current values are conservative but sized for test workloads.
- If you use a different ingress controller, update annotations and class (`kubernetes.io/ingress.class`).

## Helm (alternative)
- Chart path: `k8s/helm/supercheck`
- Example:
  ```bash
  helm upgrade --install supercheck k8s/helm/supercheck \
    --namespace supercheck --create-namespace \
    -f my-values.yaml
  ```
