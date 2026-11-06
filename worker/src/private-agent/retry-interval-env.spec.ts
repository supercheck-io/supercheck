import { Logger } from '@nestjs/common';
import { resetDeprecatedEnvWarnings } from '../common/deprecated-env';
import { resolveRetryIntervalMs } from './private-agent-runner';

describe('resolveRetryIntervalMs', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    resetDeprecatedEnvWarnings();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('prefers PRIVATE_AGENT_RETRY_INTERVAL_MS without warning', () => {
    expect(
      resolveRetryIntervalMs({
        PRIVATE_AGENT_RETRY_INTERVAL_MS: '1000',
        PRIVATE_AGENT_POLL_INTERVAL_MS: '9000',
      }),
    ).toBe(1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('honors the deprecated PRIVATE_AGENT_POLL_INTERVAL_MS and warns once', () => {
    const env = { PRIVATE_AGENT_POLL_INTERVAL_MS: '9000' };
    expect(resolveRetryIntervalMs(env)).toBe(9000);
    expect(resolveRetryIntervalMs(env)).toBe(9000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('PRIVATE_AGENT_POLL_INTERVAL_MS');
  });

  it('uses the default when neither is set', () => {
    expect(resolveRetryIntervalMs({})).toBe(5000);
    expect(warn).not.toHaveBeenCalled();
  });
});
