import { ConfigService } from '@nestjs/config';
import { buildRedisOptions } from './redis-options';

describe('buildRedisOptions', () => {
  it('keeps direct Redis compatibility when Sentinel is not configured', () => {
    const config = new ConfigService({
      REDIS_HOST: 'redis',
      REDIS_PORT: '6380',
    });
    expect(buildRedisOptions(config)).toMatchObject({
      host: 'redis',
      port: 6380,
    });
  });

  it('uses all configured Sentinel identities and the named master', () => {
    const config = new ConfigService({
      REDIS_SENTINELS: 'sentinel-0:26379,sentinel-1:26379,sentinel-2:26379',
      REDIS_SENTINEL_MASTER: 'mymaster',
      REDIS_PASSWORD: 'secret',
    });
    expect(buildRedisOptions(config)).toMatchObject({
      sentinels: [
        { host: 'sentinel-0', port: 26379 },
        { host: 'sentinel-1', port: 26379 },
        { host: 'sentinel-2', port: 26379 },
      ],
      name: 'mymaster',
      password: 'secret',
    });
  });

  it('fails closed for malformed Sentinel endpoints', () => {
    const config = new ConfigService({ REDIS_SENTINELS: 'missing-port' });
    expect(() => buildRedisOptions(config)).toThrow('Invalid REDIS_SENTINELS');
  });
});
