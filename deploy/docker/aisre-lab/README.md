# AI SRE Integration Lab

The AI SRE lab is an opt-in Docker Compose overlay for testing read-only connectors, webhook delivery, alert fire/recovery behavior, and seeded live evals without connecting to customer production systems.

```bash
cd supercheck/deploy/docker

# Start Supercheck plus the full OSS lab profile.
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig \
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml \
  --profile aisre-lab up -d

# Trigger deterministic demo signals.
curl http://127.0.0.1:18080/checkout
curl http://127.0.0.1:18080/checkout/slow
curl http://127.0.0.1:18080/checkout/error

# Inspect captured Alertmanager or Supercheck webhook payloads.
curl http://127.0.0.1:18081/payloads
```

Lab endpoints bind to `127.0.0.1` by default:

| Endpoint | Default URL |
| --- | --- |
| Demo service | `http://127.0.0.1:18080` |
| Webhook capture | `http://127.0.0.1:18081` |
| Grafana | `http://127.0.0.1:13000` |
| Prometheus | `http://127.0.0.1:19090` |
| Alertmanager | `http://127.0.0.1:19093` |
| Loki | `http://127.0.0.1:13100` |
| Tempo | `http://127.0.0.1:13200` |

Use the `core`, `logs`, and `traces` profiles when you want only part of the lab:

```bash
# Metrics, alerts, Grafana, demo service, and webhook capture only.
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile core up -d

# Add logs or traces independently.
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile logs up -d
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile traces up -d
```

Keep this lab behind a firewall on shared hosts. It is not a production observability stack.
