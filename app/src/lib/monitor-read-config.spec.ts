import { monitorConfigForRead, monitorTargetForRead, monitorResultDetailsForRead } from './monitor-read-config';
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
      port: 443, protocol: 'tcp',
      expectClosed: true, enableSslCheck: true, sslDaysUntilExpirationWarning: 14, sslCheckFrequencyHours: 12,
      sslLastCheckedAt: '2026-01-01T00:00:00.000Z', timeoutSeconds: 10, regions: ['eu-central'],
      locationConfig: { enabled: true, locations: ['eu-central'], threshold: 1, strategy: 'any' },
      retryStrategy: { maxRetries: 1, backoffFactor: 2 }, alertChannels: ['channel-1'],
      testId: '00000000-0000-4000-8000-000000000001', testTitle: 'Checkout',
      playwrightOptions: { headless: true, timeout: 30000, retries: 0 },
    };
    expect(monitorConfigForRead({ ...full, headers: { A: 'b' }, body: 'x', auth: { type: 'none' } }, false))
      .toEqual({ ...full, auth: { type: 'none' } });
  });
});

describe('monitor target reads', () => {
  const secretUrl = 'https://user:pa55@example.com/health?api_key=abc123&page=2&token=xyz';

  it('masks embedded credentials and secret query values for viewers only', () => {
    const masked = monitorTargetForRead(secretUrl, false);
    for (const secret of ['user', 'pa55', 'abc123', 'xyz']) expect(masked).not.toContain(secret);
    expect(masked).toContain('example.com/health');
    expect(masked).toContain('page=2');
    expect(monitorTargetForRead(secretUrl, true)).toBe(secretUrl);
  });
  it('returns targets without credentials exactly unchanged', () => {
    for (const target of ['https://example.com/a?b=1', 'HTTP://Example.com', 'example.com', '10.0.0.1', 'not a url', 'https://', '']) {
      expect(monitorTargetForRead(target, false)).toBe(target);
    }
    expect(monitorTargetForRead(null, false)).toBeNull();
    expect(monitorTargetForRead(undefined, false)).toBeUndefined();
  });
  it('marks masked userinfo so it is recognizable', () => {
    expect(monitorTargetForRead('https://user:pa55@example.com/', false)).toBe('https://REDACTED@example.com/');
  });
  it('masks userinfo even when only a username is present', () => {
    expect(monitorTargetForRead('https://deploy-token@example.com/x', false)).not.toContain('deploy-token');
  });
  it('masks authorization, key-style and jwt parameter names', () => {
    for (const name of ['authorization', 'access_key', 'private-key', 'client_key', 'pass', 'jwt', 'X-Amz-Signature', 'accessToken']) {
      const masked = monitorTargetForRead(`https://example.com/?${name}=private-value`, false);
      expect(masked).not.toContain('private-value');
    }
  });
  it('masks credentials hidden behind malformed prefixes, fragments and extra parameter names', () => {
    for (const target of [
      ' https://u:private-value@h.example/', 'https:/u:private-value@h.example/', 'https:u:private-value@h.example/',
      'https://h.example/#access_token=private-value', 'https://h.example/?otp=private-value',
      'https://h.example/?sid=private-value', 'https://h.example/?appkey=private-value', 'https://h.example/?ticket=private-value',
    ]) {
      expect(monitorTargetForRead(target, false)).not.toContain('private-value');
    }
  });
  it('leaves non-http schemes and plain fragments alone', () => {
    for (const target of ['localhost:3000', 'ftp://u:p@h.example/', 'https://h.example/docs#section-2']) {
      expect(monitorTargetForRead(target, false)).toBe(target);
    }
  });
  it('keeps author, authority and code parameters visible', () => {
    for (const name of ['author', 'authors', 'authority', 'code', 'page']) {
      const target = `https://example.com/?${name}=visible`;
      expect(monitorTargetForRead(target, false)).toBe(target);
    }
  });
  it('does not treat unrelated parameters such as author as secret', () => {
    expect(monitorTargetForRead('https://example.com/?author=jo', false)).toBe('https://example.com/?author=jo');
  });
});

describe('monitor result detail reads', () => {
  const details = {
    statusCode: 200,
    responseHeaders: {
      'content-type': 'text/html', 'Set-Cookie': ['sid=private-session; HttpOnly'] as unknown as string,
      authorization: 'private-auth', 'x-api-key': 'private-key', 'X-CSRF-Token': 'private-csrf',
      'cache-control': 'no-store',
    },
  };

  it('replaces sensitive header values but keeps the field shape and other headers', () => {
    const out = monitorResultDetailsForRead(details);
    expect(JSON.stringify(out)).not.toMatch(/private-/);
    expect(out.responseHeaders).toMatchObject({
      'content-type': 'text/html', 'cache-control': 'no-store', 'Set-Cookie': '[REDACTED]', authorization: '[REDACTED]',
    });
    expect(out.statusCode).toBe(200);
    expect(details.responseHeaders.authorization).toBe('private-auth');
  });
  it('redacts additional credential-style header names', () => {
    const out = monitorResultDetailsForRead({ responseHeaders: { 'X-Auth': 'private-a', 'x-jwt': 'private-b', 'X-Hub-Signature': 'private-c', 'x-password': 'private-d', 'x-request-id': 'visible' } });
    expect(JSON.stringify(out)).not.toMatch(/private-/);
    expect(out.responseHeaders).toMatchObject({ 'x-request-id': 'visible' });
  });
  it('returns details without headers, and null or undefined, untouched', () => {
    const plain = { statusCode: 500, errorMessage: 'boom' };
    expect(monitorResultDetailsForRead(plain)).toBe(plain);
    expect(monitorResultDetailsForRead(null)).toBeNull();
    expect(monitorResultDetailsForRead(undefined)).toBeUndefined();
  });
});
