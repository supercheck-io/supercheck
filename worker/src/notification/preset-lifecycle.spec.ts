import * as path from 'node:path';
import * as worker from './preset-lifecycle';

// require(), not import: the app file must stay out of the worker's TypeScript build.
const app = require(
  path.resolve(
    __dirname,
    '../../../app/src/lib/notification-providers/preset-lifecycle',
  ),
) as typeof worker;

const ALERT_TYPES = [
  'monitor_failure',
  'monitor_recovery',
  'job_failed',
  'job_success',
  'job_timeout',
  'ssl_expiring',
  'ssl_renewed',
  undefined,
];
const PRESETS = [...worker.PAGING_PRESETS, 'custom', undefined, 42];
const ACTIONS: worker.PresetAction[] = ['trigger', 'resolve'];

describe('preset lifecycle', () => {
  it('raises PagerDuty failures to critical and SSL expiry to warning', () => {
    for (const alertType of ['monitor_failure', 'job_failed', 'job_timeout'])
      expect(
        worker.presetOverrides('pagerduty', 'trigger', { alertType }),
      ).toEqual({ normalizedSeverity: 'critical' });
    expect(
      worker.presetOverrides('pagerduty', 'trigger', {
        alertType: 'ssl_expiring',
      }),
    ).toEqual({ normalizedSeverity: 'warning' });
    expect(
      worker.presetOverrides('pagerduty', 'resolve', {
        alertType: 'monitor_recovery',
      }),
    ).toEqual({});
  });

  it('maps Better Stack and incident.io status to their vocabulary', () => {
    expect(worker.presetOverrides('better_stack', 'trigger', {})).toEqual({
      status: 'alert',
    });
    expect(worker.presetOverrides('better_stack', 'resolve', {})).toEqual({
      status: 'resolved',
    });
    expect(worker.presetOverrides('incident_io', 'trigger', {})).toEqual({
      status: 'firing',
    });
    expect(worker.presetOverrides('incident_io', 'resolve', {})).toEqual({
      status: 'resolved',
    });
  });

  it('leaves custom webhooks and other presets alone', () => {
    for (const preset of [
      'custom',
      undefined,
      'opsgenie',
      'jsm_ops',
      'splunk_on_call',
    ])
      expect(
        worker.presetOverrides(preset, 'resolve', { alertType: 'job_failed' }),
      ).toEqual({});
  });

  it('recognises paging presets only', () => {
    expect(worker.isPagingPreset('jsm_ops')).toBe(true);
    expect(worker.isPagingPreset('custom')).toBe(false);
    expect(worker.isPagingPreset(undefined)).toBe(false);
  });

  describe('presetResolveRequest', () => {
    it('closes Opsgenie and JSM alerts by alias on the configured host', () => {
      expect(
        worker.presetResolveRequest(
          'opsgenie',
          'https://api.eu.opsgenie.com/v2/alerts/',
          'monitor:m-1',
          'Down',
        ),
      ).toEqual({
        url: 'https://api.eu.opsgenie.com/v2/alerts/monitor%3Am-1/close?identifierType=alias',
        method: 'POST',
        body: JSON.stringify({ source: 'Supercheck', note: 'Down' }),
      });
      expect(
        worker.presetResolveRequest(
          'jsm_ops',
          'https://api.atlassian.com/jsm/ops/integration/v2/alerts?x=1#h',
          'job:j',
          't',
        )?.url,
      ).toBe(
        'https://api.atlassian.com/jsm/ops/integration/v2/alerts/job%3Aj/close?identifierType=alias',
      );
    });

    it('encodes an alias carrying / ? # or .. so it cannot change the path or host', () => {
      for (const alias of [
        'a/b',
        'a?b=c',
        'x#y',
        '../../evil',
        '//evil.example.com',
        '@evil.example.com',
      ]) {
        const request = worker.presetResolveRequest(
          'opsgenie',
          'https://api.opsgenie.com/v2/alerts',
          alias,
          't',
        );
        const url = new URL(request!.url);
        expect(url.origin).toBe('https://api.opsgenie.com');
        expect(url.pathname).toBe(
          `/v2/alerts/${encodeURIComponent(alias)}/close`,
        );
        expect(url.search).toBe('?identifierType=alias');
      }
    });

    it('returns null for presets that resolve through their template', () => {
      for (const preset of [
        'pagerduty',
        'incident_io',
        'better_stack',
        'splunk_on_call',
        'custom',
        undefined,
      ])
        expect(
          worker.presetResolveRequest(
            preset,
            'https://x.example.com',
            'k',
            't',
          ),
        ).toBeNull();
    });

    it('bounds the note length', () => {
      const body = worker.presetResolveRequest(
        'opsgenie',
        'https://api.opsgenie.com/v2/alerts',
        'k',
        'x'.repeat(5000),
      )!.body;
      expect(JSON.parse(body).note).toHaveLength(1000);
    });
  });

  it('matches the app mirror for every preset, action and alert type', () => {
    expect(app.PAGING_PRESETS).toEqual(worker.PAGING_PRESETS);
    for (const preset of PRESETS) {
      expect(app.isPagingPreset(preset)).toBe(worker.isPagingPreset(preset));
      for (const action of ACTIONS)
        for (const alertType of ALERT_TYPES)
          expect(app.presetOverrides(preset, action, { alertType })).toEqual(
            worker.presetOverrides(preset, action, { alertType }),
          );
      for (const alias of ['monitor:1', 'a/b?c', '../x'])
        expect(
          app.presetResolveRequest(
            preset,
            'https://api.opsgenie.com/v2/alerts/',
            alias,
            'T',
          ),
        ).toEqual(
          worker.presetResolveRequest(
            preset,
            'https://api.opsgenie.com/v2/alerts/',
            alias,
            'T',
          ),
        );
    }
  });
});
