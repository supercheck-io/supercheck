/**
 * Paging-preset lifecycle fixes applied at send time, by preset id. Preset templates are copied into a
 * channel when it is saved, so fixing a template would never reach channels customers already have.
 * Pure: mirrored in app/src/lib/notification-providers/preset-lifecycle.ts (a parity spec keeps them equal).
 */

export const PAGING_PRESETS = [
  'pagerduty',
  'opsgenie',
  'jsm_ops',
  'splunk_on_call',
  'better_stack',
  'incident_io',
] as const;

export type PagingPreset = (typeof PAGING_PRESETS)[number];

export type PresetAction = 'trigger' | 'resolve';

export function isPagingPreset(value: unknown): value is PagingPreset {
  return (
    typeof value === 'string' &&
    (PAGING_PRESETS as readonly string[]).includes(value)
  );
}

const CRITICAL_ALERT_TYPES = new Set([
  'monitor_failure',
  'job_failed',
  'job_timeout',
]);

/** Template variables a preset needs that the generic variables get wrong. Empty for custom webhooks. */
export function presetOverrides(
  preset: unknown,
  action: PresetAction,
  vars: { alertType?: string },
): Record<string, string> {
  switch (preset) {
    case 'pagerduty':
      if (vars.alertType && CRITICAL_ALERT_TYPES.has(vars.alertType))
        return { normalizedSeverity: 'critical' };
      if (vars.alertType === 'ssl_expiring')
        return { normalizedSeverity: 'warning' };
      return {};
    case 'better_stack':
      return { status: action === 'resolve' ? 'resolved' : 'alert' };
    case 'incident_io':
      return { status: action === 'resolve' ? 'resolved' : 'firing' };
    default:
      return {};
  }
}

/**
 * Opsgenie and JSM close an alert with a separate call by alias; a second create would only add a note.
 * Returns null for presets that resolve with the normal templated request.
 */
export function presetResolveRequest(
  preset: unknown,
  configuredUrl: string,
  dedupKey: string,
  title: string,
): { url: string; method: 'POST'; body: string } | null {
  if (preset !== 'opsgenie' && preset !== 'jsm_ops') return null;
  const base = new URL(configuredUrl);
  const url = new URL(base.href);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(dedupKey)}/close`;
  url.searchParams.set('identifierType', 'alias');
  // The alias is encoded, so this can only fail if URL parsing itself misbehaves; never send elsewhere.
  if (url.origin !== base.origin) {
    throw new Error('Close request must stay on the configured host');
  }
  return {
    url: url.href,
    method: 'POST',
    body: JSON.stringify({ source: 'Supercheck', note: title.slice(0, 1000) }),
  };
}
