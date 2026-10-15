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
});
