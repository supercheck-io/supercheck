// Kept in step with the PagerDuty preset in app/src/lib/notification-providers/webhook-presets.ts (the CLI cannot import the
// app package); notifications.test.ts compares the two. The routing key goes in the body template, as in the web form.
export const PAGERDUTY_URL = 'https://events.pagerduty.com/v2/enqueue'
const PAGERDUTY_BODY_TEMPLATE = {
  routing_key: '',
  event_action: '{{pagerDutyEventAction}}',
  dedup_key: '{{dedupKey}}',
  payload: {
    summary: '{{title}}',
    severity: '{{normalizedSeverity}}',
    source: 'supercheck',
    component: '{{targetName}}',
    custom_details: {
      message: '{{message}}',
      alert_type: '{{type}}',
      status: '{{status}}',
      monitor_type: '{{monitorType}}',
      target_url: '{{targetUrl}}',
      response_time_ms: '{{responseTime}}',
      dashboard_url: '{{dashboardUrl}}',
      project: '{{projectName}}',
    },
  },
  links: [{ href: '{{dashboardUrl}}', text: 'Open in Supercheck' }],
}

export const pagerDutyBodyTemplate = (routingKey: string): string =>
  JSON.stringify({ ...PAGERDUTY_BODY_TEMPLATE, routing_key: routingKey }, null, 2)

/** The webhook config of a PagerDuty Events API v2 channel. */
export const pagerDutyConfig = (routingKey: string): Record<string, unknown> => ({
  preset: 'pagerduty',
  url: PAGERDUTY_URL,
  method: 'POST',
  headers: {},
  bodyTemplate: pagerDutyBodyTemplate(routingKey),
})

/** PAGERDUTY_ROUTING_KEY, trimmed, or undefined when unset, blank or still the preset placeholder. */
export function routingKeyFromEnv(): string | undefined {
  const key = process.env.PAGERDUTY_ROUTING_KEY?.trim()
  return key && !key.startsWith('REPLACE_WITH_') ? key : undefined
}
