/**
 * Cancellation is the only way an operator can stop a running execution. The
 * fail-open behaviour (Redis unavailable → not cancelled) is deliberate: losing
 * a cancellation request must not kill unrelated runs. These tests pin that
 * contract plus the Redis key shape and TTL.
 */
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CancellationService } from './cancellation.service';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const RedisMock = Redis as unknown as jest.Mock;

function createService() {
  const client = {
    on: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
  };
  RedisMock.mockImplementation(() => client);
  const config = {
    get: (_key: string, fallback?: string) => fallback,
  } as unknown as ConfigService;
  return { service: new CancellationService(config), client };
}

describe('CancellationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes a cancellation flag with a one hour TTL', async () => {
    const { service, client } = createService();

    await service.setCancellationSignal('run-1');

    expect(client.setex).toHaveBeenCalledWith(
      'supercheck:cancel:run-1',
      3600,
      '1',
    );
  });

  it('reports a run as cancelled only for the exact stored flag', async () => {
    const { service, client } = createService();

    client.get.mockResolvedValueOnce('1');
    await expect(service.isCancelled('run-1')).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith('supercheck:cancel:run-1');

    client.get.mockResolvedValueOnce(null);
    await expect(service.isCancelled('run-1')).resolves.toBe(false);

    client.get.mockResolvedValueOnce('0');
    await expect(service.isCancelled('run-1')).resolves.toBe(false);
  });

  it('deletes the cancellation flag when a run finishes', async () => {
    const { service, client } = createService();

    await service.clearCancellationSignal('run-1');

    expect(client.del).toHaveBeenCalledWith('supercheck:cancel:run-1');
  });

  it('fails open when Redis cannot read the flag', async () => {
    const { service, client } = createService();
    client.get.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.isCancelled('run-1')).resolves.toBe(false);
  });

  it('does not throw when writing or clearing the flag fails', async () => {
    const { service, client } = createService();
    client.setex.mockRejectedValueOnce(new Error('READONLY'));
    client.del.mockRejectedValueOnce(new Error('READONLY'));

    await expect(
      service.setCancellationSignal('run-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.clearCancellationSignal('run-1'),
    ).resolves.toBeUndefined();
  });

  it('registers an error handler on the Redis connection', () => {
    const { client } = createService();

    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = client.on.mock.calls[0][1] as (error: Error) => void;
    expect(() => handler(new Error('boom'))).not.toThrow();
  });

  it('disconnects once and tolerates a second destroy or a missing client', async () => {
    const { service, client } = createService();

    service.destroy();
    service.destroy();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    await expect(
      service.setCancellationSignal('run-1'),
    ).resolves.toBeUndefined();
    await expect(service.isCancelled('run-1')).resolves.toBe(false);
    await expect(
      service.clearCancellationSignal('run-1'),
    ).resolves.toBeUndefined();
    expect(client.setex).not.toHaveBeenCalled();
  });
});
