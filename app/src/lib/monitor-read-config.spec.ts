import { monitorConfigForRead } from './monitor-read-config';
import type { MonitorConfig } from '@/db/schema';

const config: MonitorConfig = {
  method: 'POST', enableSslCheck: true,
  auth: { type: 'basic', username: 'user', password: 'private-password' },
  headers: { Authorization: 'Bearer private-token', 'X-Custom': 'private-key' },
  body: 'private-body',
};

describe('monitor configuration reads', () => {
  it('removes credentials and request payloads from viewer responses without mutation', () => {
    expect(monitorConfigForRead(config, false)).toEqual({
      method: 'POST', enableSslCheck: true, auth: { type: 'basic' },
    });
    expect(config.auth?.password).toBe('private-password');
    expect(config.headers?.Authorization).toContain('private-token');
  });
  it('preserves the complete edit payload for updaters', () => {
    expect(monitorConfigForRead(config, true)).toBe(config);
  });
  it('removes bearer tokens and handles absent configuration', () => {
    expect(monitorConfigForRead({ auth: { type: 'bearer', token: 'private' } }, false))
      .toEqual({ auth: { type: 'bearer' } });
    expect(monitorConfigForRead(null, false)).toBeNull();
  });
  it('keeps auth type "none" and omits auth when absent', () => {
    expect(monitorConfigForRead({ auth: { type: 'none' } }, false)).toEqual({ auth: { type: 'none' } });
    expect(monitorConfigForRead({ method: 'GET' }, false)).not.toHaveProperty('auth');
  });
  it('drops undeclared keys that may hold secrets in legacy rows', () => {
    const legacy = { method: 'GET', apiKey: 'private', customSecret: { nested: 'private' } } as MonitorConfig;
    expect(monitorConfigForRead(legacy, false)).toEqual({ method: 'GET' });
  });
  it('ignores a malformed auth value instead of throwing', () => {
    const malformed = { method: 'GET', auth: 'private-string' } as unknown as MonitorConfig;
    expect(monitorConfigForRead(malformed, false)).toEqual({ method: 'GET' });
  });
  it('preserves every non-secret field the monitor views and filters read', () => {
    const full: MonitorConfig = {
      method: 'PUT', expectedStatusCodes: '200-299', keywordInBody: 'ok', keywordInBodyShouldBePresent: false,
      responseBodyJsonPath: { path: '$.status', expectedValue: 'up' }, port: 443, protocol: 'tcp',
      expectClosed: true, enableSslCheck: true, sslDaysUntilExpirationWarning: 14, sslCheckFrequencyHours: 12,
      sslLastCheckedAt: '2026-01-01T00:00:00.000Z', sslCheckOnStatusChange: true, checkExpiration: true,
      daysUntilExpirationWarning: 30, checkRevocation: false, timeoutSeconds: 10, regions: ['eu-central'],
      locationConfig: { enabled: true, locations: ['eu-central'], threshold: 1, strategy: 'any' },
      retryStrategy: { maxRetries: 1, backoffFactor: 2 }, alertChannels: ['channel-1'],
      testId: '00000000-0000-4000-8000-000000000001', testTitle: 'Checkout',
      playwrightOptions: { headless: true, timeout: 30000, retries: 0 },
    };
    expect(monitorConfigForRead({ ...full, headers: { A: 'b' }, body: 'x', auth: { type: 'none' } }, false))
      .toEqual({ ...full, auth: { type: 'none' } });
  });
});
