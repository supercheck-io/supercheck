# PagerDuty & OpsGenie Webhook Integration — Canary Release

> **Version:** `v1.3.4-canary.1`
> **Status:** Available for testing
> **Issue:** [#294](https://github.com/supercheck-io/supercheck/issues/294)

## What Changed

The Custom Webhook notification provider now supports:

- **Custom JSON body templates** with safe variable interpolation (`{{variableName}}` syntax)
- **Configurable HTTP method** — GET, POST, or PUT (default: POST)
- **Custom headers** via the API (UI support planned for a future release)

This enables direct integration with PagerDuty Events API v2, OpsGenie Alert API, and any other service that accepts JSON webhooks.

## How to Test

### Upgrade to the Canary

**Docker Compose (Hetzner or any self-hosted server):**

```bash
cd deploy/docker

# Pull and deploy the canary version
SUPERCHECK_VERSION=1.3.4-canary.1 docker compose up -d

# Verify the containers are running the correct version
docker compose ps
docker compose logs app --tail 20
docker compose logs worker --tail 20
```

**Kubernetes:**

```bash
# The K8s manifests have been updated. Apply:
cd deploy/k8s
KUSTOMIZE_OVERLAY=production ./deploy.sh

# Verify rollout
kubectl rollout status deployment/supercheck-app -n supercheck
kubectl rollout status deployment/supercheck-worker-us -n supercheck-workers
```

### PagerDuty Setup

1. In PagerDuty, go to **Services → Service Directory → select your service**
2. Go to the **Integrations** tab and click **Add Integration**
3. Search for **Events API V2** and add it
4. Copy the **Integration Key** (also called Routing Key)
5. In Supercheck, go to **Alerts → Notification Channels** and create a new **Webhook** provider with:
   - **URL:** `https://events.pagerduty.com/v2/enqueue`
   - **Method:** POST
   - **Body Template:**

```json
{
  "routing_key": "YOUR_PAGERDUTY_INTEGRATION_KEY",
  "event_action": "trigger",
  "payload": {
    "summary": "{{title}}",
    "severity": "{{normalizedSeverity}}",
    "source": "supercheck",
    "component": "{{monitorName}}",
    "custom_details": {
      "message": "{{message}}",
      "monitor_type": "{{monitorType}}",
      "target_url": "{{targetUrl}}",
      "response_time": "{{responseTime}}",
      "dashboard_url": "{{dashboardUrl}}"
    }
  }
}
```

6. Click **Test Connection** to verify (PagerDuty should return a 202 Accepted)
7. Attach the provider to a monitor and trigger a test failure

> **Note:** Use `{{normalizedSeverity}}` instead of `{{severity}}` because PagerDuty expects `critical`, `error`, `warning`, or `info` — it does not accept `success`. Supercheck maps `success` alerts to `info` automatically.

### OpsGenie Setup

1. In OpsGenie, go to **Settings → Integration List → API**
2. Copy the **API Key**
3. In Supercheck, create a Webhook notification channel with:
   - **URL:** `https://api.opsgenie.com/v2/alerts`
   - **Method:** POST
   - **Body Template:**

```json
{
  "message": "{{title}}",
  "description": "{{message}}",
  "priority": "P2",
  "source": "supercheck",
  "tags": ["supercheck", "{{monitorType}}"],
  "details": {
    "monitor": "{{monitorName}}",
    "status": "{{status}}",
    "target_url": "{{targetUrl}}",
    "response_time": "{{responseTime}}"
  }
}
```

> **Note:** OpsGenie requires an `Authorization: GenieKey YOUR_KEY` header. Since custom headers are not yet available in the UI, you can use OpsGenie's [email integration](https://docs.opsgenie.com/docs/email-integration) or set the API key via an API proxy endpoint as a workaround.

### Verification Checklist

After configuring the integration, please verify the following:

- [ ] **Test Connection** button in the provider form returns success
- [ ] PagerDuty receives a test event (check the service's **Activity** tab)
- [ ] A real monitor failure triggers an incident in PagerDuty/OpsGenie
- [ ] A monitor recovery triggers a follow-up notification
- [ ] Alert history in Supercheck shows the delivery status as successful
- [ ] Template variables are correctly interpolated (no raw `{{variableName}}` in the received payload)

## Available Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{title}}` | Alert title | `Monitor Down - API Health` |
| `{{message}}` | Alert message | `Monitor "API Health" is down. Connection timeout` |
| `{{severity}}` | Raw Supercheck severity | `error`, `warning`, `success`, `info` |
| `{{normalizedSeverity}}` | Normalized for APIs that reject `success` | `error`, `warning`, `info` |
| `{{status}}` | Monitor or job status | `down`, `up`, `failed`, `passed` |
| `{{monitorName}}` | Monitor or target name | `API Health` |
| `{{targetName}}` | Same as monitorName | `API Health` |
| `{{targetUrl}}` | Monitored URL | `https://api.example.com/health` |
| `{{targetId}}` | Target ID | `uuid` |
| `{{timestamp}}` | ISO 8601 timestamp | `2025-01-15T10:30:00.000Z` |
| `{{type}}` | Alert type | `monitor_failure`, `monitor_recovery`, `job_failed` |
| `{{projectName}}` | Project name | `My Project` |
| `{{projectId}}` | Project ID | `uuid` |
| `{{responseTime}}` | Response time in ms | `5200` |
| `{{errorMessage}}` | Error details | `Connection timeout` |
| `{{monitorType}}` | Monitor type | `http_request`, `website`, `ping_host`, `port_check` |
| `{{dashboardUrl}}` | Link to Supercheck dashboard | `https://app.supercheck.io/...` |

## Technical Details

- Templates must be valid JSON. Supercheck parses and re-serializes the template after variable substitution to ensure the final payload is always valid JSON.
- Template variables are safely escaped before interpolation — values containing quotes, newlines, or other special characters will not break the JSON structure.
- Unknown template variables (e.g., `{{unknownVar}}`) are preserved as-is in the output.
- GET requests omit the body (standard HTTP behavior). Use POST or PUT for body templates.
- Webhook delivery has a 10-second timeout and logs failures to the alert history.

## Documentation

- [Alerts & Webhooks Guide](https://supercheck.io/docs/app/communicate/alerts) — includes PagerDuty and OpsGenie setup instructions with body template examples
- [CHANGELOG](https://github.com/supercheck-io/supercheck/blob/main/CHANGELOG.md) — see the Unreleased section

## Rollback

If you encounter any issues, revert to the stable release:

```bash
# Docker Compose
SUPERCHECK_VERSION=1.3.4 docker compose up -d

# Or without the canary tag (uses the compose file default)
docker compose up -d
```

---

Please let us know how the testing goes. If you run into any issues or have feedback, comment on [#294](https://github.com/supercheck-io/supercheck/issues/294).
