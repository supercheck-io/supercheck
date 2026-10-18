import { HeartbeatService } from './heartbeat.service';
import { ConfigService } from '@nestjs/config';
it('immediately publishes queue registration and removal instead of waiting for the next heartbeat', () => {
  const service = new HeartbeatService({
    get: (_key: string, fallback: unknown) => fallback,
  } as ConfigService);
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  service['redis'] = redis as never;
  service.addQueues(['monitor-eu']);
  expect(JSON.parse(redis.set.mock.calls[0][1]).queues).toContain('monitor-eu');
  service.removeQueues(['monitor-eu']);
  expect(JSON.parse(redis.set.mock.calls[1][1]).queues).not.toContain(
    'monitor-eu',
  );
});
